import { TokenService } from '@nestjs/authentication';
import { Injectable, Logger } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { AdminCustomer, AdminCustomerQuery, TaskStatus } from '@sibimate/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { bookings, helperAvailability, helperProfiles, tasks, users } from '../db/schema.js';
import { TaskStateService } from '../tasks/task-state.service.js';

/** Tasks a helper has taken and not yet been paid for. Blocking waits until they are settled. */
const UNDER_WAY: readonly TaskStatus[] = ['assigned', 'en_route', 'in_progress', 'completed', 'disputed'];
/** Tasks nobody has taken yet. Blocking cancels them, so no helper is sent to a blocked customer. */
const UNTAKEN: readonly TaskStatus[] = ['posted', 'matching', 'expired'];

/** The dashboard's Customers page: everyone who has signed in, and blocking accounts that misuse the service. */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger('Customers');

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly taskState: TaskStateService,
    private readonly tokens: TokenService,
  ) {}

  /** Up to 100 accounts, newest first, matching part of a name or phone number. Deleted accounts are left out. */
  async list({ q }: AdminCustomerQuery): Promise<AdminCustomer[]> {
    const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const { rows } = await this.db.execute<{
      id: string;
      name: string | null;
      phone: string;
      language: AdminCustomer['language'];
      status: AdminCustomer['status'];
      blocked_reason: string | null;
      is_helper: boolean;
      created_at: Date | string;
      total: string;
      open: string;
      done: string;
      cancelled: string;
      last_task_at: Date | string | null;
    }>(sql`
      select
        u.id, u.name, u.phone, u.language, u.status, u.blocked_reason, u.created_at,
        exists (select 1 from helper_profiles hp where hp.user_id = u.id and hp.status = 'active') as is_helper,
        count(t.id) as total,
        count(t.id) filter (where t.status not in ('paid', 'closed', 'cancelled')) as open,
        count(t.id) filter (where t.status in ('paid', 'closed')) as done,
        count(t.id) filter (where t.status = 'cancelled') as cancelled,
        max(t.created_at) as last_task_at
      from users u
      left join tasks t on t.customer_id = u.id
      where u.status <> 'deleted'
        ${pattern ? sql`and (u.phone ilike ${pattern} or u.name ilike ${pattern})` : sql``}
      group by u.id
      order by u.created_at desc
      limit 100
    `);
    const iso = (value: Date | string) => new Date(value).toISOString();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      language: row.language,
      status: row.status,
      blockedReason: row.blocked_reason,
      isHelper: row.is_helper,
      joinedAt: iso(row.created_at),
      tasks: {
        total: Number(row.total),
        open: Number(row.open),
        done: Number(row.done),
        cancelled: Number(row.cancelled),
      },
      lastTaskAt: row.last_task_at ? iso(row.last_task_at) : null,
    }));
  }

  /**
   * Blocks an account: it is signed out everywhere and cannot sign in again.
   * Refused while a helper is on one of the person's tasks, or while they are
   * on a job themselves; tasks nobody has taken are cancelled.
   */
  async block(userId: string, reason: string, adminId: string): Promise<{ cancelledTasks: number }> {
    const user = await this.find(userId);
    if (user.status !== 'active') {
      throw new ApiException(409, 'conflict', 'This account is already blocked.');
    }
    const [underWay] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.customerId, userId), inArray(tasks.status, [...UNDER_WAY])))
      .limit(1);
    const [onJob] = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(helperProfiles, eq(bookings.helperId, helperProfiles.id))
      .where(and(eq(helperProfiles.userId, userId), eq(bookings.status, 'active')))
      .limit(1);
    if (underWay || onJob) {
      throw new ApiException(
        409,
        'conflict',
        'This person has a job under way. Settle it, or its dispute, before blocking the account.',
      );
    }

    const untaken = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.customerId, userId), inArray(tasks.status, [...UNTAKEN])));
    for (const task of untaken) {
      await this.taskState.transition(task.id, 'cancelled', { role: 'admin', id: adminId });
    }

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ status: 'blocked', blockedReason: reason }).where(eq(users.id, userId));
      // A helper account stops being shown tasks at once.
      await tx
        .update(helperAvailability)
        .set({ isOnline: false })
        .where(
          inArray(
            helperAvailability.helperId,
            tx.select({ id: helperProfiles.id }).from(helperProfiles).where(eq(helperProfiles.userId, userId)),
          ),
        );
    });
    // Access tokens already issued stop working at once, as the account is no longer active.
    await this.tokens.revokeAll(userId);
    this.logger.log(`User ${userId} blocked; ${untaken.length} untaken task(s) cancelled`);
    return { cancelledTasks: untaken.length };
  }

  async unblock(userId: string): Promise<void> {
    const user = await this.find(userId);
    if (user.status !== 'blocked') {
      throw new ApiException(409, 'conflict', 'This account is not blocked.');
    }
    await this.db.update(users).set({ status: 'active', blockedReason: null }).where(eq(users.id, userId));
  }

  private async find(userId: string) {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), sql`${users.status} <> 'deleted'`));
    if (!user) {
      throw new ApiException(404, 'not_found', 'Customer not found.');
    }
    return user;
  }
}
