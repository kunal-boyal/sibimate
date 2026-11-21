import { JOB_GAP_MINUTES } from '@sibimate/shared';
import { type SQL, sql } from 'drizzle-orm';

/**
 * When a task happens: its slot, or now for a task wanted now and for one whose
 * slot has passed. `schedule` is the task's schedule_at column.
 */
export const taskTime = (schedule: SQL) => sql`greatest(${schedule}, now())`;

/**
 * True when helper `helperId` has a job that is not finished within
 * JOB_GAP_MINUTES of `at`. A finished job waiting only for payment never clashes.
 */
export const hasClashingJob = (helperId: SQL, at: SQL) => sql`exists (
  select 1 from bookings cb
  join tasks ct on ct.id = cb.task_id
  where cb.helper_id = ${helperId}
    and cb.status = 'active'
    and ct.status in ('assigned', 'en_route', 'in_progress')
    and abs(extract(epoch from (${at} - greatest(ct.schedule_at, now())))) < ${JOB_GAP_MINUTES * 60}
)`;

/** True when the helper has a job that is not finished, at any time. Used to rank free helpers first. */
export const hasOpenJob = (helperId: SQL) => sql`exists (
  select 1 from bookings ob
  join tasks ot on ot.id = ob.task_id
  where ob.helper_id = ${helperId}
    and ob.status = 'active'
    and ot.status in ('assigned', 'en_route', 'in_progress')
)`;
