import { Inject, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { ACTIVE_TASK_STATUSES, type ListTasksQuery, type Task, type TaskList } from '@sibimate/shared';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { createTaskSchema } from '@sibimate/shared';
import { AddressCipher } from '../common/address-cipher.js';
import { ApiException } from '../common/api-exception.js';
import { bookingCode } from '../common/booking-code.js';
import { ENV, type Env } from '../config/env.js';
import type { Database } from '../db/db.js';
import {
  type TaskCategoryRow,
  type TaskRow,
  type UserRow,
  bookings,
  helperAvailability,
  helperProfiles,
  taskCategories,
  taskInterpretations,
  taskOffers,
  tasks,
  users,
} from '../db/schema.js';
import { InterpretationService, categoryOf } from '../interpretation/interpretation.service.js';
import { TaskStateService } from './task-state.service.js';

type CreateTaskInput = z.output<typeof createTaskSchema>;

@Injectable()
export class TasksService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly addressCipher: AddressCipher,
    private readonly interpretations: InterpretationService,
    private readonly taskState: TaskStateService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(customer: UserRow, input: CreateTaskInput, idempotencyKey: string): Promise<Task> {
    if (input.paymentMethod !== 'cash') {
      throw invalid('paymentMethod', 'Only cash to the helper is available for now.');
    }
    const scheduleAt = input.scheduleAt ? new Date(input.scheduleAt) : null;
    if (scheduleAt && scheduleAt.getTime() <= Date.now()) {
      throw invalid('scheduleAt', 'Pick a time in the future.');
    }

    const interpretation = input.interpretationId
      ? await this.interpretations.findUsable(input.interpretationId, customer.id)
      : undefined;
    if (input.interpretationId && !interpretation) {
      throw invalid('interpretationId', 'These task details can no longer be used. Describe the task again.');
    }

    const created = await this.db.transaction(async (tx) => {
      let categoryId: string | null = null;
      let provisional = false;
      if (interpretation) {
        const listed = await tx.select().from(taskCategories);
        const category = categoryOf(interpretation.output, listed);
        provisional = category.provisional;
        // A category the model proposed is saved inactive, for an admin to approve or merge.
        await tx
          .insert(taskCategories)
          .values({
            slug: category.slug,
            name: category.name,
            requiresSkilled: interpretation.output.requiresSkilled,
            source: 'ai',
            reviewStatus: 'pending',
            active: false,
          })
          .onConflictDoNothing();
        const [row] = await tx.select().from(taskCategories).where(eq(taskCategories.slug, category.slug));
        categoryId = row!.id;
      }

      // One statement decides whether this key has been used, so a retry never makes a second task.
      const [task] = await tx
        .insert(tasks)
        .values({
          customerId: customer.id,
          categoryId,
          interpretationId: interpretation?.id,
          title: input.title,
          descriptionRaw: interpretation?.inputText ?? input.description,
          descriptionRefined: input.description,
          requiresSkilled: input.requiresSkilled,
          details: interpretation && {
            estimatedMinutes: interpretation.output.estimatedMinutes,
            requirements: interpretation.output.requirements,
          },
          pickupPoint: input.pickup,
          addressEnc: this.addressCipher.encrypt(input.address),
          scheduleAt,
          customerPrice: input.customerPrice,
          helpersNeeded: input.helpersNeeded,
          paymentMethod: input.paymentMethod,
          status: 'posted',
          needsReview: !interpretation || interpretation.needsReview || provisional,
          idempotencyKey,
          // Set here, to the millisecond, so list cursors can name a row exactly.
          createdAt: new Date(),
        })
        .onConflictDoNothing({ target: [tasks.customerId, tasks.idempotencyKey] })
        .returning({ id: tasks.id });
      if (!task) {
        return null;
      }

      await this.taskState.record(tx, task.id, null, 'posted', { role: 'customer', id: customer.id });
      if (interpretation) {
        await tx
          .update(taskInterpretations)
          .set({ decision: 'accepted' })
          .where(eq(taskInterpretations.id, interpretation.id));
      }
      return task;
    });

    if (!created) {
      const [existing] = await this.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.customerId, customer.id), eq(tasks.idempotencyKey, idempotencyKey)));
      return this.get(customer, existing!.id);
    }

    // Matching starts at once. Until the matching engine exists, an admin assigns the helper from here.
    await this.taskState.transition(created.id, 'matching', { role: 'system' });
    return this.get(customer, created.id);
  }

  async get(customer: UserRow, id: string): Promise<Task> {
    const [row] = await this.query(and(eq(tasks.id, id), eq(tasks.customerId, customer.id))).limit(1);
    if (!row) {
      throw new ApiException(404, 'not_found', 'Task not found.');
    }
    const found = await this.bookingsFor([row.task]);
    return this.toTask(row.task, row.category, row.pickup, found.get(row.task.id));
  }

  async list(customer: UserRow, { status, cursor, limit }: ListTasksQuery): Promise<TaskList> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.query(
      and(
        eq(tasks.customerId, customer.id),
        status === 'active' ? inArray(tasks.status, [...ACTIVE_TASK_STATUSES]) : undefined,
        after
          ? or(lt(tasks.createdAt, after.createdAt), and(eq(tasks.createdAt, after.createdAt), lt(tasks.id, after.id)))
          : undefined,
      ),
    )
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const found = await this.bookingsFor(page.map((row) => row.task));
    return {
      items: page.map((row) => this.toTask(row.task, row.category, row.pickup, found.get(row.task.id))),
      nextCursor: rows.length > limit && last ? encodeCursor(last.task) : null,
    };
  }

  async cancel(customer: UserRow, id: string): Promise<Task> {
    await this.taskState.transition(
      id,
      'cancelled',
      { role: 'customer', id: customer.id },
      {
        allow: (task) => task.customerId === customer.id,
        // A confirmed helper is released in the same step.
        within: (tx) =>
          tx
            .update(bookings)
            .set({ status: 'cancelled' })
            .where(and(eq(bookings.taskId, id), eq(bookings.status, 'active'))),
      },
    );
    return this.get(customer, id);
  }

  /** Posts an expired task again, optionally at a higher price. Matching starts over. */
  async retry(customer: UserRow, id: string, customerPrice?: number): Promise<Task> {
    await this.taskState.transition(
      id,
      'matching',
      { role: 'customer', id: customer.id },
      {
        allow: (task) => task.customerId === customer.id,
        within: async (tx) => {
          if (customerPrice !== undefined) {
            await tx.update(tasks).set({ customerPrice }).where(eq(tasks.id, id));
          }
          // Helpers shown the task before can be shown it again.
          await tx.delete(taskOffers).where(eq(taskOffers.taskId, id));
        },
      },
    );
    return this.get(customer, id);
  }

  private query(where: ReturnType<typeof and>) {
    return this.db
      .select({
        task: tasks,
        category: taskCategories,
        pickup: {
          lat: sql<number>`ST_Y(${tasks.pickupPoint}::geometry)`,
          lng: sql<number>`ST_X(${tasks.pickupPoint}::geometry)`,
        },
      })
      .from(tasks)
      .leftJoin(taskCategories, eq(tasks.categoryId, taskCategories.id))
      .where(where)
      .$dynamic();
  }

  /** The confirmed helper for each task that has one, with the codes the customer gives them. */
  private async bookingsFor(list: TaskRow[]): Promise<Map<string, NonNullable<Task['booking']>>> {
    const found = new Map<string, NonNullable<Task['booking']>>();
    if (list.length === 0) {
      return found;
    }
    const rows = await this.db
      .select({
        booking: bookings,
        skillTag: helperProfiles.skillTag,
        name: users.name,
        phone: users.phone,
        lat: sql<number | null>`ST_Y(${helperAvailability.lastLocation}::geometry)`,
        lng: sql<number | null>`ST_X(${helperAvailability.lastLocation}::geometry)`,
        // Every task in the list belongs to the same customer.
        myRating: sql<
          number | null
        >`(select r.rating from reviews r where r.booking_id = ${bookings.id} and r.author_id = ${list[0]!.customerId})`,
      })
      .from(bookings)
      .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .leftJoin(helperAvailability, eq(helperAvailability.helperId, helperProfiles.id))
      .innerJoin(users, eq(helperProfiles.userId, users.id))
      .where(
        and(
          inArray(
            bookings.taskId,
            list.map((task) => task.id),
          ),
          ne(bookings.status, 'cancelled'),
        ),
      );
    for (const { booking, skillTag, name, phone, lat, lng, myRating } of rows) {
      const status = list.find((task) => task.id === booking.taskId)!.status;
      const code = (purpose: 'start' | 'completion') => bookingCode(this.env.OTP_SECRET, booking.id, purpose);
      found.set(booking.taskId, {
        id: booking.id,
        helper: { name, phone, skillTag },
        agreedPrice: booking.agreedPrice,
        startCode: status === 'assigned' || status === 'en_route' ? code('start') : null,
        completionCode: status === 'in_progress' ? code('completion') : null,
        // The helper's position is shared only while they are travelling to the customer.
        myRating,
        helperLocation: status === 'en_route' && lat !== null && lng !== null ? { lat, lng } : null,
      });
    }
    return found;
  }

  private toTask(
    task: TaskRow,
    category: TaskCategoryRow | null,
    pickup: { lat: number; lng: number },
    booking?: Task['booking'],
  ): Task {
    return {
      id: task.id,
      title: task.title,
      description: task.descriptionRefined,
      category: category && {
        slug: category.slug,
        name: category.name,
        provisional: category.reviewStatus !== 'approved',
      },
      requiresSkilled: task.requiresSkilled,
      helpersNeeded: task.helpersNeeded,
      customerPrice: task.customerPrice,
      paymentMethod: task.paymentMethod,
      scheduleAt: task.scheduleAt?.toISOString() ?? null,
      status: task.status,
      address: this.addressCipher.decrypt(task.addressEnc),
      pickup,
      booking: booking ?? null,
      createdAt: task.createdAt.toISOString(),
    };
  }
}

function invalid(path: string, message: string) {
  return new ApiException(400, 'validation_failed', 'Validation failed', [{ path, message }]);
}

function encodeCursor(task: TaskRow): string {
  return Buffer.from(`${task.createdAt.toISOString()}|${task.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw invalid('cursor', 'Unknown cursor.');
  }
  return { createdAt, id: id! };
}
