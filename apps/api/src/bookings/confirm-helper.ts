import { DEFAULT_COMMISSION_BPS, JOB_GAP_MINUTES, VERIFICATION_LEVELS, commissionFor } from '@sibimate/shared';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import { type HelperProfileRow, type TaskRow, bookings, helperProfiles, taskCategories, taskOffers } from '../db/schema.js';
import type { Transaction } from '../tasks/task-state.service.js';
import { hasClashingJob, taskTime } from './job-clash.js';

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

  // Locking the helper's row makes two confirmations for the same helper take turns,
  // so the second sees the first's booking.
  await tx.select({ id: helperProfiles.id }).from(helperProfiles).where(eq(helperProfiles.id, helper.id)).for('update');
  const when = taskTime(sql`${task.scheduleAt}::timestamptz`);
  const {
    rows: [clash],
  } = await tx.execute<{ clash: boolean }>(sql`select ${hasClashingJob(sql`${helper.id}::uuid`, when)} as clash`);
  if (clash?.clash) {
    throw new ApiException(409, 'job_clash', 'This helper already has a job around that time.');
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
  // The helper's offers on other tasks around the same time are withdrawn; offers for other times stay open.
  await tx.execute(sql`
    update task_offers o set status = 'withdrawn', updated_at = now()
    from tasks t
    where t.id = o.task_id
      and o.helper_id = ${helper.id}
      and o.task_id <> ${task.id}
      and o.status in ('notified', 'quoted')
      and abs(extract(epoch from (${taskTime(sql`t.schedule_at`)} - ${when}))) < ${JOB_GAP_MINUTES * 60}
  `);

  return booking!.id;
}
