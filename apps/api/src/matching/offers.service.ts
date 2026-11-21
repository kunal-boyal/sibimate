import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import {
  DEFAULT_COMMISSION_BPS,
  type NearbyTask,
  type OfferResult,
  type Quote,
  type TaskOffer,
  commissionFor,
} from '@sibimate/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { confirmHelper } from '../bookings/confirm-helper.js';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import {
  type HelperProfileRow,
  type TaskOfferRow,
  type TaskRow,
  type UserRow,
  helperProfiles,
  taskCategories,
  taskOffers,
  tasks,
  users,
} from '../db/schema.js';
import { Notifier } from '../live/notifier.js';
import { TaskStateService } from '../tasks/task-state.service.js';

const OPEN = ['notified', 'quoted'] as const;
const gone = (message: string) => new ApiException(409, 'offer_unavailable', message);
const notFound = () => new ApiException(404, 'not_found', 'Task not found.');

/** What helpers do with the tasks they are shown, and how a customer picks between their offers. */
@Injectable()
export class OffersService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly taskState: TaskStateService,
    private readonly notifier: Notifier,
  ) {}

  // Helper

  /** The tasks this helper has been shown and can still take. The exact address is never included. */
  async nearby(helper: HelperProfileRow): Promise<NearbyTask[]> {
    const rows = await this.db
      .select({ offer: taskOffers, task: tasks, category: taskCategories.name })
      .from(taskOffers)
      .innerJoin(tasks, eq(taskOffers.taskId, tasks.id))
      .leftJoin(taskCategories, eq(tasks.categoryId, taskCategories.id))
      .where(
        and(eq(taskOffers.helperId, helper.id), inArray(taskOffers.status, [...OPEN]), eq(tasks.status, 'matching')),
      )
      .orderBy(desc(taskOffers.createdAt))
      .limit(30);
    return rows.map(({ offer, task, category }) => ({
      id: task.id,
      title: task.title,
      description: task.descriptionRefined,
      category,
      requiresSkilled: task.requiresSkilled,
      helpersNeeded: task.helpersNeeded,
      scheduleAt: task.scheduleAt?.toISOString() ?? null,
      paymentMethod: task.paymentMethod,
      distanceM: offer.distanceM ?? 0,
      customerPrice: task.customerPrice,
      netAtCustomerPrice: task.customerPrice - commissionFor(task.customerPrice, DEFAULT_COMMISSION_BPS),
      commissionBps: DEFAULT_COMMISSION_BPS,
      instant: !task.requiresSkilled,
      myOffer: offer.status === 'quoted' && offer.price !== null ? { price: offer.price, etaMin: offer.etaMin } : null,
      createdAt: offer.createdAt.toISOString(),
    }));
  }

  /**
   * The helper takes the task at the customer's price. The first helper to
   * accept gets it. For a skilled job the customer always chooses, so
   * accepting sends an offer at the customer's price instead.
   */
  async accept(helper: HelperProfileRow, taskId: string): Promise<OfferResult> {
    const { task } = await this.openOffer(helper, taskId);
    if (task.requiresSkilled) {
      return this.quote(helper, taskId, { price: task.customerPrice });
    }
    try {
      let bookingId = '';
      await this.taskState.transition(
        taskId,
        'assigned',
        { role: 'helper', id: helper.userId },
        {
          within: async (tx, locked) => {
            bookingId = await confirmHelper(tx, locked, helper, locked.customerPrice);
          },
        },
      );
      return { outcome: 'assigned', bookingId };
    } catch (error) {
      if (error instanceof ApiException && error.code === 'job_clash') {
        throw new ApiException(409, 'job_clash', 'You already have a job around that time.');
      }
      // The task's row lock made a second helper wait; by then it was no longer looking for one.
      if (error instanceof ApiException && error.code === 'invalid_transition') {
        throw gone('Another helper took this task.');
      }
      throw error;
    }
  }

  /** The helper names their own price. The customer picks an offer or waits for more. */
  async quote(helper: HelperProfileRow, taskId: string, { price, etaMin }: Quote): Promise<OfferResult> {
    const { offer } = await this.openOffer(helper, taskId);
    await this.db
      .update(taskOffers)
      .set({ status: 'quoted', price, etaMin: etaMin ?? null })
      .where(and(eq(taskOffers.id, offer.id), inArray(taskOffers.status, [...OPEN])));
    // The customer sees the offer arrive.
    await this.notifier.taskChanged(taskId);
    return { outcome: 'offered', bookingId: null };
  }

  async decline(helper: HelperProfileRow, taskId: string): Promise<void> {
    await this.db
      .update(taskOffers)
      .set({ status: 'declined' })
      .where(
        and(eq(taskOffers.taskId, taskId), eq(taskOffers.helperId, helper.id), inArray(taskOffers.status, [...OPEN])),
      );
  }

  // Customer

  async listForCustomer(customer: UserRow, taskId: string): Promise<TaskOffer[]> {
    const [task] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.customerId, customer.id)));
    if (!task) {
      throw notFound();
    }
    const rows = await this.db
      .select({ offer: taskOffers, helper: helperProfiles, name: users.name })
      .from(taskOffers)
      .innerJoin(helperProfiles, eq(taskOffers.helperId, helperProfiles.id))
      .innerJoin(users, eq(helperProfiles.userId, users.id))
      .where(and(eq(taskOffers.taskId, taskId), eq(taskOffers.status, 'quoted')))
      .orderBy(asc(taskOffers.price), asc(taskOffers.updatedAt));
    return rows.map(({ offer, helper, name }) => ({
      id: offer.id,
      // Only a helper verified as skilled shows the skilled tag on their offer.
      helper: {
        name,
        skillTag: helper.skillTag,
        completedCount: helper.completedCount,
        rating: helper.ratingCount > 0 ? Math.round((helper.ratingSum / helper.ratingCount) * 10) / 10 : null,
      },
      price: offer.price!,
      etaMin: offer.etaMin,
      distanceM: offer.distanceM,
    }));
  }

  /** The customer picks a helper's offer. The agreed price is the helper's. */
  async choose(customer: UserRow, taskId: string, offerId: string): Promise<void> {
    try {
      await this.taskState.transition(
        taskId,
        'assigned',
        { role: 'customer', id: customer.id },
        {
          allow: (task) => task.customerId === customer.id,
          within: async (tx, task) => {
            const [row] = await tx
              .select({ offer: taskOffers, helper: helperProfiles })
              .from(taskOffers)
              .innerJoin(helperProfiles, eq(taskOffers.helperId, helperProfiles.id))
              .where(and(eq(taskOffers.id, offerId), eq(taskOffers.taskId, taskId), eq(taskOffers.status, 'quoted')));
            if (!row || row.offer.price === null) {
              throw gone('This offer is no longer available.');
            }
            await confirmHelper(tx, task, row.helper, row.offer.price);
          },
        },
      );
    } catch (error) {
      if (error instanceof ApiException && error.code === 'job_clash') {
        throw gone('This helper has just taken another job around that time. Choose another offer.');
      }
      throw error;
    }
  }

  private async openOffer(helper: HelperProfileRow, taskId: string): Promise<{ offer: TaskOfferRow; task: TaskRow }> {
    const [row] = await this.db
      .select({ offer: taskOffers, task: tasks })
      .from(taskOffers)
      .innerJoin(tasks, eq(taskOffers.taskId, tasks.id))
      .where(and(eq(taskOffers.taskId, taskId), eq(taskOffers.helperId, helper.id)));
    // A helper can act only on tasks they were shown.
    if (!row) {
      throw notFound();
    }
    if (row.task.status !== 'matching' || !OPEN.some((status) => status === row.offer.status)) {
      throw gone('This task is no longer available.');
    }
    return row;
  }
}
