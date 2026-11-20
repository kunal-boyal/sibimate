import { DEFAULT_COMMISSION_BPS, VERIFICATION_LEVELS, commissionFor } from '@sibimate/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import { type HelperProfileRow, type TaskRow, bookings, taskCategories, taskOffers } from '../db/schema.js';
import type { Transaction } from '../tasks/task-state.service.js';

export const helperUnavailable = (message: string) => new ApiException(409, 'helper_unavailable', message);

/**
 * Makes `helper` the confirmed helper of `task` at `price`, inside the
 * transaction that moves the task to assigned. However the helper was chosen
 * (instant accept, the customer picking an offer, or an admin), this is the one
 * place the rules are checked and the booking is written.
 */
export async function confirmHelper(tx: Transaction, task: TaskRow, helper: HelperProfileRow, price: number) {
  if (helper.status !== 'active') {
    throw helperUnavailable('This helper is not active.');
  }
  if (task.customerId === helper.userId) {
    throw helperUnavailable('A helper cannot take their own task.');
  }
  const [category] = task.categoryId
    ? await tx.select().from(taskCategories).where(eq(taskCategories.id, task.categoryId))
    : [];
  const rank = (level: (typeof VERIFICATION_LEVELS)[number]) => VERIFICATION_LEVELS.indexOf(level);
  if (category && rank(helper.verificationLevel) < rank(category.minVerificationLevel)) {
    throw helperUnavailable(`This task needs a helper verified to the ${category.minVerificationLevel} level.`);
  }

  const [booking] = await tx
    .insert(bookings)
    .values({
      taskId: task.id,
      helperId: helper.id,
      agreedPrice: price,
      commissionBps: DEFAULT_COMMISSION_BPS,
      commission: commissionFor(price, DEFAULT_COMMISSION_BPS),
    })
    .returning({ id: bookings.id });

  const open = inArray(taskOffers.status, ['notified', 'quoted']);
  // The other helpers shown this task can no longer take it.
  await tx
    .update(taskOffers)
    .set({ status: 'expired' })
    .where(and(eq(taskOffers.taskId, task.id), ne(taskOffers.helperId, helper.id), open));
  await tx
    .update(taskOffers)
    .set({ status: 'accepted' })
    .where(and(eq(taskOffers.taskId, task.id), eq(taskOffers.helperId, helper.id)));
  // A helper does one job at a time, so their offers on other tasks are withdrawn.
  await tx
    .update(taskOffers)
    .set({ status: 'withdrawn' })
    .where(and(eq(taskOffers.helperId, helper.id), ne(taskOffers.taskId, task.id), open));

  return booking!.id;
}

/** True for the database's refusal of a second active booking for a helper or a task. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) => (value as { code?: string } | null)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}
