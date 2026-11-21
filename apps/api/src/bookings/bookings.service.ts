import { Inject, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  type AdminTask,
  type AdminListTasksQuery,
  type HelperBooking,
  type PlatformSettings,
  type TaskStatus,
} from '@sibimate/shared';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AddressCipher } from '../common/address-cipher.js';
import { ApiException } from '../common/api-exception.js';
import { bookingCode } from '../common/booking-code.js';
import { ENV, type Env } from '../config/env.js';
import type { Database } from '../db/db.js';
import {
  type BookingRow,
  type HelperProfileRow,
  bookings,
  disputes,
  helperProfiles,
  taskCategories,
  taskOffers,
  tasks,
  users,
} from '../db/schema.js';
import { TaskStateService } from '../tasks/task-state.service.js';
import { canRaiseDispute, disputeView } from '../disputes/dispute-rules.js';
import { SettingsService } from '../settings/settings.service.js';
import { confirmHelper, helperUnavailable } from './confirm-helper.js';

export const CODE_RULES = { maxAttempts: 5, lockMinutes: 10 } as const;

/** The helper sees the exact address from the moment they set off until the job is paid. */
const ADDRESS_VISIBLE: readonly TaskStatus[] = ['en_route', 'in_progress', 'completed'];
const UNASSIGNED: readonly TaskStatus[] = ['posted', 'matching', 'expired'];
const UNDER_WAY: readonly TaskStatus[] = ['assigned', 'en_route', 'in_progress', 'completed', 'disputed'];

const helperUsers = alias(users, 'helper_users');

@Injectable()
export class BookingsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly addressCipher: AddressCipher,
    private readonly taskState: TaskStateService,
    private readonly settings: SettingsService,
  ) {}

  // Admin

  async listForAdmin({ status }: AdminListTasksQuery): Promise<AdminTask[]> {
    const rows = await this.db
      .select({
        task: tasks,
        category: taskCategories,
        customer: { name: users.name, phone: users.phone },
        helper: { id: helperProfiles.id, name: helperUsers.name, phone: helperUsers.phone },
      })
      .from(tasks)
      .innerJoin(users, eq(tasks.customerId, users.id))
      .leftJoin(taskCategories, eq(tasks.categoryId, taskCategories.id))
      .leftJoin(bookings, and(eq(bookings.taskId, tasks.id), ne(bookings.status, 'cancelled')))
      .leftJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .leftJoin(helperUsers, eq(helperProfiles.userId, helperUsers.id))
      .where(
        status === 'all' ? undefined : inArray(tasks.status, [...(status === 'unassigned' ? UNASSIGNED : UNDER_WAY)]),
      )
      .orderBy(desc(tasks.createdAt))
      .limit(100);

    return rows.map(({ task, category, customer, helper }) => ({
      id: task.id,
      title: task.title,
      description: task.descriptionRefined,
      category: category && {
        slug: category.slug,
        name: category.name,
        provisional: category.reviewStatus !== 'approved',
      },
      requiresSkilled: task.requiresSkilled,
      minVerificationLevel: task.minVerificationLevel,
      helpersNeeded: task.helpersNeeded,
      customerPrice: task.customerPrice,
      paymentMethod: task.paymentMethod,
      scheduleAt: task.scheduleAt?.toISOString() ?? null,
      searchRadiusM: task.searchRadiusM,
      status: task.status,
      needsReview: task.needsReview,
      createdAt: task.createdAt.toISOString(),
      customer,
      address: this.addressCipher.decrypt(task.addressEnc),
      helper: helper?.id && helper.phone ? { id: helper.id, name: helper.name, phone: helper.phone } : null,
    }));
  }

  /** Confirms a helper on a task that is looking for one, at the customer's price. */
  async assign(taskId: string, helperId: string, adminId: string): Promise<void> {
    const [helper] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.id, helperId));
    if (!helper) {
      throw helperUnavailable('This helper is not active.');
    }
    try {
      await this.taskState.transition(
        taskId,
        'assigned',
        { role: 'admin', id: adminId },
        { within: (tx, task) => confirmHelper(tx, task, helper, task.customerPrice) },
      );
    } catch (error) {
      if (error instanceof ApiException && error.code === 'job_clash') {
        throw helperUnavailable('This helper already has a job around that time.');
      }
      throw error;
    }
  }

  // Helper

  async listForHelper(helper: HelperProfileRow): Promise<HelperBooking[]> {
    const rows = await this.helperQuery(eq(bookings.helperId, helper.id))
      // Jobs not yet finished first, soonest first, then the most recent.
      .orderBy(
        sql`${bookings.status} = 'active' desc`,
        sql`case when ${bookings.status} = 'active' then coalesce(${tasks.scheduleAt}, ${bookings.createdAt}) end asc`,
        desc(bookings.createdAt),
      )
      .limit(30);
    const rules = await this.settings.current();
    return rows.map((row) => this.toHelperBooking(row, rules, helper.userId));
  }

  async getForHelper(helper: HelperProfileRow, bookingId: string): Promise<HelperBooking> {
    const [row] = await this.helperQuery(and(eq(bookings.helperId, helper.id), eq(bookings.id, bookingId))).limit(1);
    if (!row) {
      throw notFound();
    }
    return this.toHelperBooking(row, await this.settings.current(), helper.userId);
  }

  async enRoute(helper: HelperProfileRow, bookingId: string): Promise<HelperBooking> {
    const booking = await this.active(helper, bookingId);
    // A helper can hold jobs at different times, but travels to one at a time.
    const [current] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .where(
        and(
          eq(bookings.helperId, helper.id),
          eq(bookings.status, 'active'),
          ne(bookings.id, booking.id),
          inArray(tasks.status, ['en_route', 'in_progress']),
        ),
      )
      .limit(1);
    if (current) {
      throw new ApiException(409, 'job_under_way', 'Finish the job you are on before setting off for this one.');
    }
    await this.taskState.transition(booking.taskId, 'en_route', actor(helper));
    return this.getForHelper(helper, bookingId);
  }

  /** The helper enters the code the customer reads out at the door. */
  async start(helper: HelperProfileRow, bookingId: string, code: string): Promise<HelperBooking> {
    const booking = await this.active(helper, bookingId);
    await this.checkCode(booking, 'start', code);
    await this.taskState.transition(booking.taskId, 'in_progress', actor(helper), {
      within: (tx) => tx.update(bookings).set({ startedAt: new Date() }).where(eq(bookings.id, booking.id)),
    });
    return this.getForHelper(helper, bookingId);
  }

  /** The helper enters the code the customer gives when the job is done. */
  async complete(helper: HelperProfileRow, bookingId: string, code: string): Promise<HelperBooking> {
    const booking = await this.active(helper, bookingId);
    await this.checkCode(booking, 'completion', code);
    await this.taskState.transition(booking.taskId, 'completed', actor(helper), {
      within: (tx) => tx.update(bookings).set({ completedAt: new Date() }).where(eq(bookings.id, booking.id)),
    });
    return this.getForHelper(helper, bookingId);
  }

  /** The helper confirms the customer paid in cash. This ends the job and frees the helper. */
  async cashReceived(helper: HelperProfileRow, bookingId: string): Promise<HelperBooking> {
    const booking = await this.active(helper, bookingId);
    await this.taskState.transition(booking.taskId, 'paid', actor(helper), {
      within: async (tx, task) => {
        if (task.paymentMethod !== 'cash') {
          throw new ApiException(409, 'invalid_transition', 'This task is not paid in cash.');
        }
        await tx.update(bookings).set({ status: 'completed', paidAt: new Date() }).where(eq(bookings.id, booking.id));
        await tx
          .update(helperProfiles)
          .set({ completedCount: sql`${helperProfiles.completedCount} + 1` })
          .where(eq(helperProfiles.id, helper.id));
      },
    });
    return this.getForHelper(helper, bookingId);
  }

  /** The helper gives the task up before starting it. It goes back to looking for a helper. */
  async cancel(helper: HelperProfileRow, bookingId: string): Promise<HelperBooking> {
    const booking = await this.active(helper, bookingId);
    await this.taskState.transition(booking.taskId, 'matching', actor(helper), {
      within: async (tx) => {
        await tx.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, booking.id));
        // This helper is not asked again; the others whose chance ended when the task was taken can be.
        await tx
          .update(taskOffers)
          .set({ status: 'declined' })
          .where(and(eq(taskOffers.taskId, booking.taskId), eq(taskOffers.helperId, helper.id)));
        await tx.delete(taskOffers).where(and(eq(taskOffers.taskId, booking.taskId), eq(taskOffers.status, 'expired')));
        await tx
          .update(helperProfiles)
          .set({ cancelledCount: sql`${helperProfiles.cancelledCount} + 1` })
          .where(eq(helperProfiles.id, helper.id));
      },
    });
    return this.getForHelper(helper, bookingId);
  }

  private async active(helper: HelperProfileRow, bookingId: string): Promise<BookingRow> {
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.helperId, helper.id)));
    if (!booking) {
      throw notFound();
    }
    if (booking.status !== 'active') {
      throw new ApiException(409, 'invalid_transition', 'This job is no longer under way.');
    }
    return booking;
  }

  private async checkCode(booking: BookingRow, purpose: 'start' | 'completion', code: string) {
    const now = new Date();
    if (booking.codeLockedUntil && booking.codeLockedUntil > now) {
      throw new ApiException(
        429,
        'code_locked',
        'Too many wrong codes. Wait a few minutes and ask the customer again.',
        {
          retryAfter: Math.ceil((booking.codeLockedUntil.getTime() - now.getTime()) / 1000),
        },
      );
    }
    if (code === bookingCode(this.env.OTP_SECRET, booking.id, purpose)) {
      await this.db.update(bookings).set({ codeAttempts: 0, codeLockedUntil: null }).where(eq(bookings.id, booking.id));
      return;
    }
    // Counted in the database, so guesses sent at once cannot slip past the limit.
    const [counted] = await this.db
      .update(bookings)
      .set({ codeAttempts: sql`${bookings.codeAttempts} + 1` })
      .where(eq(bookings.id, booking.id))
      .returning({ attempts: bookings.codeAttempts });
    if (counted!.attempts >= CODE_RULES.maxAttempts) {
      await this.db
        .update(bookings)
        .set({ codeAttempts: 0, codeLockedUntil: new Date(now.getTime() + CODE_RULES.lockMinutes * 60_000) })
        .where(eq(bookings.id, booking.id));
    }
    throw new ApiException(400, 'code_invalid', 'That code is not correct.');
  }

  private helperQuery(where: ReturnType<typeof and>) {
    return this.db
      .select({
        booking: bookings,
        task: tasks,
        category: taskCategories.name,
        customer: { name: users.name, phone: users.phone },
        myRating: sql<
          number | null
        >`(select r.rating from reviews r where r.booking_id = ${bookings.id} and r.author_id = (select hp.user_id from helper_profiles hp where hp.id = ${bookings.helperId}))`,
        dispute: disputes,
      })
      .from(bookings)
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .leftJoin(disputes, eq(disputes.bookingId, bookings.id))
      .innerJoin(users, eq(tasks.customerId, users.id))
      .leftJoin(taskCategories, eq(tasks.categoryId, taskCategories.id))
      .where(where)
      .$dynamic();
  }

  private toHelperBooking(
    {
      booking,
      task,
      category,
      customer,
      myRating,
      dispute,
    }: Awaited<ReturnType<BookingsService['helperQuery']>>[number],
    rules: PlatformSettings,
    viewerId: string,
  ): HelperBooking {
    // A job this helper gave up or lost shows as cancelled, whatever the task went on to do.
    const status = booking.status === 'cancelled' ? 'cancelled' : task.status;
    const current = booking.status === 'active';
    return {
      id: booking.id,
      status,
      title: task.title,
      description: task.descriptionRefined,
      category,
      helpersNeeded: task.helpersNeeded,
      scheduleAt: task.scheduleAt?.toISOString() ?? null,
      paymentMethod: task.paymentMethod,
      agreedPrice: booking.agreedPrice,
      commission: booking.commission,
      netAmount: booking.agreedPrice - booking.commission,
      // Contact details and the address are for the job in hand only.
      customer: current ? customer : { name: customer.name, phone: '' },
      address: current && ADDRESS_VISIBLE.includes(task.status) ? this.addressCipher.decrypt(task.addressEnc) : null,
      myRating,
      canDispute: booking.status === 'cancelled' ? false : canRaiseDispute('helper', status, booking, rules, !!dispute),
      dispute: disputeView(dispute, viewerId),
      createdAt: booking.createdAt.toISOString(),
    };
  }
}

const actor = (helper: HelperProfileRow) => ({ role: 'helper' as const, id: helper.userId });
const notFound = () => new ApiException(404, 'not_found', 'Job not found.');
