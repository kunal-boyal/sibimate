import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { GeoPoint } from '@sibimate/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/db.js';
import { type HelperProfileRow, bookings, helperProfiles, taskOffers, tasks } from '../db/schema.js';
import { EventBus, type LiveEvent } from './event-bus.js';

/** Tells the people concerned that something changed. A failure here never fails the action itself. */
@Injectable()
export class Notifier {
  private readonly logger = new Logger('Live');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  /** A task changed: tell its customer, every helper shown it or booked on it, and the dashboards. */
  async taskChanged(taskId: string): Promise<void> {
    await this.send(async () => {
      const [task] = await this.db.select({ customerId: tasks.customerId }).from(tasks).where(eq(tasks.id, taskId));
      if (!task) {
        return null;
      }
      const offered = await this.db
        .select({ userId: helperProfiles.userId })
        .from(taskOffers)
        .innerJoin(helperProfiles, eq(taskOffers.helperId, helperProfiles.id))
        .where(eq(taskOffers.taskId, taskId));
      const booked = await this.db
        .select({ userId: helperProfiles.userId })
        .from(bookings)
        .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
        .where(eq(bookings.taskId, taskId));
      const userIds = [
        ...new Set([task.customerId, ...offered.map((row) => row.userId), ...booked.map((row) => row.userId)]),
      ];
      return { userIds, admins: true, name: 'task.changed', data: { taskId } };
    });
  }

  /** A helper on the way moved: tell the customer waiting for them. */
  async helperMoved(helper: HelperProfileRow, location: GeoPoint): Promise<void> {
    await this.send(async () => {
      const [job] = await this.db
        .select({ taskId: tasks.id, customerId: tasks.customerId })
        .from(bookings)
        .innerJoin(tasks, eq(bookings.taskId, tasks.id))
        .where(
          and(eq(bookings.helperId, helper.id), eq(bookings.status, 'active'), inArray(tasks.status, ['en_route'])),
        );
      return job
        ? {
            userIds: [job.customerId],
            admins: false,
            name: 'helper.location',
            data: { taskId: job.taskId, ...location },
          }
        : null;
    });
  }

  /** A person's helper application was decided: tell them. */
  async profileChanged(userId: string): Promise<void> {
    await this.send(async () => ({ userIds: [userId], admins: true, name: 'profile.changed', data: {} }));
  }

  /** Someone applied or uploaded a document: tell the dashboards. */
  async applicationsChanged(): Promise<void> {
    await this.send(async () => ({ userIds: [], admins: true, name: 'applications.changed', data: {} }));
  }

  private async send(build: () => Promise<LiveEvent | null>) {
    try {
      const event = await build();
      if (event) {
        await this.bus.publish(event);
      }
    } catch (error) {
      this.logger.warn(`Could not send a live event: ${String(error)}`);
    }
  }
}
