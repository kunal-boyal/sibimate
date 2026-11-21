import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { HELPER_SEEN_SECONDS, MATCHING_NOTIFY_LIMIT, MATCHING_RINGS } from '@sibimate/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/db.js';
import { taskOffers, tasks } from '../db/schema.js';
import { Notifier } from '../live/notifier.js';
import { hasClashingJob, hasOpenJob, taskTime } from '../bookings/job-clash.js';
import { ApiException } from '../common/api-exception.js';
import { TaskStateService } from '../tasks/task-state.service.js';
import { MatchingScheduler } from './matching-scheduler.js';

/** A task with offers waiting for the customer is given this long before it expires anyway. */
const QUOTES_GRACE_MS = 60 * 60 * 1000;

/** The "ring" that starts a scheduled task looking for a helper, ahead of its time. */
export const START_RING = -1;
/** The ring number recorded on offers found when the customer changed the search area. */
const CUSTOMER_RING = -2;
/** The ring number recorded on offers found when an admin widened the search. */
const ADMIN_RING = -3;

/** A ring's radius, after the customer's own choice: a reduced area caps it, a larger one sets its least. */
function effectiveRadius(ringRadiusM: number, task: { customerRadiusM: number | null; customerRadiusCap: boolean }) {
  if (task.customerRadiusM === null) {
    return ringRadiusM;
  }
  return task.customerRadiusCap
    ? Math.min(ringRadiusM, task.customerRadiusM)
    : Math.max(ringRadiusM, task.customerRadiusM);
}

export type RingOutcome = 'stopped' | 'expired' | 'waiting-for-customer' | { notified: number };

/**
 * Searches for helpers in widening rings. Each ring notifies the best nearby
 * helpers who have not seen the task yet, then schedules the next ring. It
 * stops as soon as the task is no longer looking for a helper.
 */
@Injectable()
export class MatchingService {
  private readonly logger = new Logger('Matching');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly taskState: TaskStateService,
    private readonly scheduler: MatchingScheduler,
    private readonly notifier: Notifier,
  ) {}

  async runRing(taskId: string, ring: number): Promise<RingOutcome> {
    if (ring === START_RING) {
      return this.startScheduled(taskId);
    }
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.status !== 'matching') {
      return 'stopped';
    }

    const step = MATCHING_RINGS[ring];
    if (!step) {
      return this.finish(taskId, ring, task.createdAt);
    }

    const radiusM = effectiveRadius(step.radiusM, task);
    const notified = await this.notify(taskId, ring, radiusM);
    await this.db.update(tasks).set({ searchRadiusM: radiusM }).where(eq(tasks.id, taskId));
    await this.scheduler.schedule(taskId, ring + 1, step.waitSeconds * 1000);
    this.logger.log(`Task ${taskId}: ring ${ring} (${radiusM} m) notified ${notified} helper(s)`);
    return { notified };
  }

  /**
   * The customer chose a search area. It replaces the current ring at once: helpers
   * newly inside it are notified now. A smaller area is also a ceiling for the
   * automatic widening that follows; a larger one only a floor.
   */
  async changeSearchArea(customerId: string, taskId: string, radiusM: number): Promise<void> {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.customerId, customerId)));
    if (!task) {
      throw new ApiException(404, 'not_found', 'Task not found.');
    }
    if (task.status !== 'matching') {
      throw new ApiException(
        409,
        'invalid_transition',
        'The search area can be changed only while looking for a helper.',
      );
    }
    await this.db
      .update(tasks)
      .set({ customerRadiusM: radiusM, customerRadiusCap: radiusM < task.searchRadiusM, searchRadiusM: radiusM })
      .where(eq(tasks.id, taskId));
    const notified = await this.notify(taskId, CUSTOMER_RING, radiusM);
    this.logger.log(`Task ${taskId}: customer set the search to ${radiusM} m, notified ${notified} helper(s)`);
    await this.notifier.taskChanged(taskId);
  }

  /**
   * An admin widens the search for a task no helper has taken. A task still
   * looking notifies the helpers newly inside the area at once. An expired task
   * starts looking again, rings and all, never smaller than this area, and the
   * helpers shown it before can be shown it again.
   */
  async widenForAdmin(taskId: string, radiusM: number, adminId: string): Promise<void> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) {
      throw new ApiException(404, 'not_found', 'Task not found.');
    }
    if (task.status !== 'matching' && task.status !== 'expired') {
      throw new ApiException(409, 'invalid_transition', 'Only a task that has no helper yet can be searched for.');
    }
    if (radiusM <= task.searchRadiusM) {
      throw new ApiException(400, 'validation_failed', 'Choose a distance larger than the current search.', [
        { path: 'radiusM', message: `Choose more than ${task.searchRadiusM / 1000} km` },
      ]);
    }
    const area = { customerRadiusM: radiusM, customerRadiusCap: false, searchRadiusM: radiusM };

    if (task.status === 'expired') {
      await this.taskState.transition(
        taskId,
        'matching',
        { role: 'admin', id: adminId },
        {
          within: async (tx) => {
            await tx.update(tasks).set(area).where(eq(tasks.id, taskId));
            await tx.delete(taskOffers).where(eq(taskOffers.taskId, taskId));
          },
        },
      );
      this.logger.log(`Task ${taskId}: an admin searched again within ${radiusM} m`);
      return;
    }
    await this.db.update(tasks).set(area).where(eq(tasks.id, taskId));
    const notified = await this.notify(taskId, ADMIN_RING, radiusM);
    this.logger.log(`Task ${taskId}: an admin widened the search to ${radiusM} m, notified ${notified} helper(s)`);
    await this.notifier.taskChanged(taskId);
  }

  /** A scheduled task's time is near: it starts looking for a helper, which runs the first ring. */
  private async startScheduled(taskId: string): Promise<RingOutcome> {
    const [task] = await this.db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId));
    if (task?.status !== 'posted') {
      return 'stopped';
    }
    await this.taskState.transition(taskId, 'matching', { role: 'system' });
    return { notified: 0 };
  }

  /** Finds, ranks and records the helpers inside `radiusM` who have not seen the task yet, and tells them. */
  private async notify(taskId: string, ring: number, radiusM: number): Promise<number> {
    // One statement finds, ranks and records the helpers, so two workers on the same ring cannot notify twice.
    const { rows } = await this.db.execute(sql`
      insert into task_offers (task_id, helper_id, ring, distance_m)
      select t.id, hp.id, ${ring}, round(ST_Distance(ha.last_location, t.pickup_point))::int
      from tasks t
      join helper_profiles hp on hp.status = 'active' and hp.user_id <> t.customer_id
      join helper_availability ha on ha.helper_id = hp.id
      where t.id = ${taskId}
        and ha.is_online
        and ha.last_location is not null
        and ha.seen_at > now() - make_interval(secs => ${HELPER_SEEN_SECONDS})
        -- The verification levels are an enum in rising order.
        and hp.verification_level >= t.min_verification_level
        -- A helper with a job around the same time cannot take this one; a job hours away is no bar.
        and not ${hasClashingJob(sql`hp.id`, taskTime(sql`t.schedule_at`))}
        and not exists (select 1 from task_offers o where o.task_id = t.id and o.helper_id = hp.id)
        -- Inside the search area, and inside the distance the helper is willing to travel.
        and ST_DWithin(ha.last_location, t.pickup_point, least(${radiusM}, ha.radius_m))
      order by
        ST_Distance(ha.last_location, t.pickup_point) / 1000.0
        + 2.0 * hp.cancelled_count / (hp.completed_count + hp.cancelled_count + 1)
        -- Helpers with no other job are told first.
        + case when ${hasOpenJob(sql`hp.id`)} then 1.0 else 0 end
      limit ${MATCHING_NOTIFY_LIMIT}
      on conflict do nothing
      returning helper_id
    `);
    if (rows.length > 0) {
      // The helpers just found see the task appear.
      await this.notifier.taskChanged(taskId);
    }
    return rows.length;
  }

  /** After the last ring: expire the task, unless helpers have made offers the customer has not chosen from. */
  private async finish(taskId: string, ring: number, createdAt: Date): Promise<RingOutcome> {
    const quotes = await this.db
      .select({ id: taskOffers.id })
      .from(taskOffers)
      .where(and(eq(taskOffers.taskId, taskId), eq(taskOffers.status, 'quoted')))
      .limit(1);
    if (quotes.length > 0 && Date.now() - createdAt.getTime() < QUOTES_GRACE_MS) {
      await this.scheduler.schedule(taskId, ring, MATCHING_RINGS.at(-1)!.waitSeconds * 1000);
      return 'waiting-for-customer';
    }
    await this.taskState.transition(
      taskId,
      'expired',
      { role: 'system' },
      {
        within: (tx) =>
          tx
            .update(taskOffers)
            .set({ status: 'expired' })
            .where(and(eq(taskOffers.taskId, taskId), inArray(taskOffers.status, ['notified', 'quoted']))),
      },
    );
    this.logger.log(`Task ${taskId}: no helper found, expired`);
    return 'expired';
  }
}
