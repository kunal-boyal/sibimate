import { Inject, Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { AdminDispute, DisputeResolution } from '@sibimate/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AddressCipher } from '../common/address-cipher.js';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type UserRow, bookings, disputes, helperProfiles, tasks, users } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';
import { TaskStateService } from '../tasks/task-state.service.js';
import { canRaiseDispute } from './dispute-rules.js';

const helperUsers = alias(users, 'helper_users');
const notFound = () => new ApiException(404, 'not_found', 'Job not found.');

@Injectable()
export class DisputesService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    @Inject(AddressCipher) private readonly addressCipher: AddressCipher,
    private readonly settings: SettingsService,
    private readonly taskState: TaskStateService,
  ) {}

  /** Either side reports a problem with a job. The task waits for an admin's decision. */
  async raise(user: UserRow, bookingId: string, reason: string): Promise<void> {
    const [row] = await this.db
      .select({ booking: bookings, task: tasks, helperUserId: helperProfiles.userId })
      .from(bookings)
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .where(eq(bookings.id, bookingId));
    const role = row?.task.customerId === user.id ? 'customer' : row?.helperUserId === user.id ? 'helper' : null;
    if (!row || !role || row.booking.status === 'cancelled') {
      throw notFound();
    }
    const [existing] = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .where(eq(disputes.bookingId, bookingId));
    if (!canRaiseDispute(role, row.task.status, row.booking, await this.settings.current(), !!existing)) {
      throw new ApiException(
        409,
        'invalid_transition',
        existing
          ? 'A problem has already been reported for this job.'
          : 'A problem cannot be reported for this job now.',
      );
    }

    await this.taskState.transition(
      row.task.id,
      'disputed',
      { role, id: user.id },
      {
        within: (tx) =>
          tx.insert(disputes).values({
            bookingId,
            raisedBy: user.id,
            raisedByRole: role,
            reason,
            previousStatus: row.task.status,
          }),
      },
    );
  }

  async list(status: 'open' | 'resolved'): Promise<AdminDispute[]> {
    const rows = await this.db
      .select({
        dispute: disputes,
        booking: bookings,
        task: tasks,
        customer: { name: users.name, phone: users.phone },
        helper: { name: helperUsers.name, phone: helperUsers.phone },
      })
      .from(disputes)
      .innerJoin(bookings, eq(disputes.bookingId, bookings.id))
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .innerJoin(users, eq(tasks.customerId, users.id))
      .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .innerJoin(helperUsers, eq(helperProfiles.userId, helperUsers.id))
      .where(eq(disputes.status, status))
      .orderBy(status === 'open' ? disputes.createdAt : desc(disputes.resolvedAt))
      .limit(100);
    return rows.map(({ dispute, booking, task, customer, helper }) => ({
      id: dispute.id,
      status: dispute.status,
      raisedBy: dispute.raisedByRole === 'helper' ? 'helper' : 'customer',
      reason: dispute.reason,
      previousStatus: dispute.previousStatus,
      createdAt: dispute.createdAt.toISOString(),
      task: { id: task.id, title: task.title, address: this.addressCipher.decrypt(task.addressEnc) },
      agreedPrice: booking.agreedPrice,
      paymentMethod: task.paymentMethod,
      customer,
      helper,
      resolution: dispute.resolution,
      resolutionNote: dispute.resolutionNote,
    }));
  }

  /**
   * An admin decides. `release`: the helper is owed the agreed price, and the job
   * counts as done. `refund`: the customer owes nothing. Either way the task closes
   * and the helper is free again. Money moves with online payments in milestone 3;
   * for cash jobs the decision is recorded and shown to both sides.
   */
  async resolve(disputeId: string, resolution: DisputeResolution, note: string, adminId: string): Promise<void> {
    const [row] = await this.db
      .select({ dispute: disputes, booking: bookings })
      .from(disputes)
      .innerJoin(bookings, eq(disputes.bookingId, bookings.id))
      .where(eq(disputes.id, disputeId));
    if (!row) {
      throw new ApiException(404, 'not_found', 'Dispute not found.');
    }
    if (row.dispute.status !== 'open') {
      throw new ApiException(409, 'conflict', 'This dispute has already been decided.');
    }
    const now = new Date();
    await this.taskState.transition(
      row.booking.taskId,
      'closed',
      { role: 'admin', id: adminId },
      {
        within: async (tx) => {
          await tx
            .update(disputes)
            .set({ status: 'resolved', resolution, resolutionNote: note, resolvedBy: adminId, resolvedAt: now })
            .where(and(eq(disputes.id, disputeId), eq(disputes.status, 'open')));
          await tx
            .update(bookings)
            // The booking ends either way, which frees the helper. What is owed follows the dispute's resolution.
            .set({ status: 'completed', completedAt: row.booking.completedAt ?? now })
            .where(eq(bookings.id, row.booking.id));
          // A job released to the helper counts as done, unless it already did when it was paid.
          if (resolution === 'release' && row.dispute.previousStatus !== 'paid') {
            await tx
              .update(helperProfiles)
              .set({ completedCount: sql`${helperProfiles.completedCount} + 1` })
              .where(eq(helperProfiles.id, row.booking.helperId));
          }
        },
      },
    );
  }
}
