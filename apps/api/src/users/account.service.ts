import { TokenService } from '@nestjs/authentication';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { InjectDisk, type StorageDisk } from '@nestjs/storage';
import { ACTIVE_TASK_STATUSES } from '@sibimate/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { AddressCipher } from '../common/address-cipher.js';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import {
  type UserRow,
  bookings,
  disputes,
  helperAvailability,
  helperDocuments,
  helperProfiles,
  otpChallenges,
  reviews,
  taskInterpretations,
  tasks,
  users,
} from '../db/schema.js';

/**
 * Deletes an account at the person's request. Records of jobs are kept, as
 * accounting needs them, but everything that identifies the person is removed
 * from them: name, phone number, addresses, their words, documents and location.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger('Account');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    @InjectDisk('documents') private readonly disk: StorageDisk,
    private readonly addressCipher: AddressCipher,
    private readonly tokens: TokenService,
  ) {}

  async delete(user: UserRow): Promise<void> {
    const [profile] = await this.db.select().from(helperProfiles).where(eq(helperProfiles.userId, user.id));
    await this.refuseWhileWorkIsOpen(user, profile?.id);

    const documents = profile
      ? await this.db
          .select({ key: helperDocuments.storageKey })
          .from(helperDocuments)
          .where(eq(helperDocuments.helperId, profile.id))
      : [];
    const removed = this.addressCipher.encrypt('[deleted]');

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          // The number is freed, so the person can sign up again later as someone new.
          phone: `deleted:${user.id}`,
          name: null,
          status: 'deleted',
          deletedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await tx.delete(otpChallenges).where(eq(otpChallenges.phone, user.phone));
      await tx.update(tasks).set({ addressEnc: removed, descriptionRaw: '' }).where(eq(tasks.customerId, user.id));
      await tx.update(taskInterpretations).set({ inputText: '' }).where(eq(taskInterpretations.customerId, user.id));
      await tx.update(reviews).set({ comment: null }).where(eq(reviews.authorId, user.id));
      if (profile) {
        await tx.delete(helperDocuments).where(eq(helperDocuments.helperId, profile.id));
        await tx.delete(helperAvailability).where(eq(helperAvailability.helperId, profile.id));
        await tx
          .update(helperProfiles)
          .set({ status: 'paused', emergencyContact: null, rejectionReason: null })
          .where(eq(helperProfiles.id, profile.id));
      }
    });

    // Every device is signed out. Access tokens already issued stop working at once, as the account is no longer active.
    await this.tokens.revokeAll(user.id);
    for (const { key } of documents) {
      await this.disk
        .delete(key)
        .catch((error: unknown) => this.logger.warn(`Could not delete a document file: ${String(error)}`));
    }
  }

  /** An account with a job still open would leave the other side stranded, so it cannot be deleted yet. */
  private async refuseWhileWorkIsOpen(user: UserRow, helperId?: string) {
    const [openTask] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.customerId, user.id), inArray(tasks.status, [...ACTIVE_TASK_STATUSES])))
      .limit(1);
    const [openJob] = helperId
      ? await this.db
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.helperId, helperId), eq(bookings.status, 'active')))
          .limit(1)
      : [];
    const [openDispute] = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .innerJoin(bookings, eq(disputes.bookingId, bookings.id))
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .where(
        and(
          eq(disputes.status, 'open'),
          or(eq(tasks.customerId, user.id), helperId ? eq(bookings.helperId, helperId) : undefined),
        ),
      )
      .limit(1);
    if (openTask || openJob || openDispute) {
      throw new ApiException(
        409,
        'account_busy',
        'Finish or cancel your open tasks and jobs before deleting your account.',
      );
    }
  }
}
