import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Admin, HelperEarnings } from '@sibimate/shared';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../admin/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { type HelperProfileRow, bookings, commissionLedger, helperProfiles, tasks } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';
import { duesOwedSql } from './dues.js';

/** Periods start at midnight in India, whatever the server's own time zone. */
const since = (unit: 'day' | 'week' | 'month') =>
  sql`date_trunc(${unit}, now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'`;

/** What helpers have earned, and the commission they owe from cash jobs. */
@Injectable()
export class EarningsService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async forHelper(helper: HelperProfileRow): Promise<HelperEarnings> {
    const net = sql`${bookings.agreedPrice} - ${bookings.commission}`;
    const paid = and(eq(bookings.helperId, helper.id), isNotNull(bookings.paidAt));
    const [totals] = await this.db
      .select({
        today: sql<number>`coalesce(sum(${net}) filter (where ${bookings.paidAt} >= ${since('day')}), 0)::int`,
        week: sql<number>`coalesce(sum(${net}) filter (where ${bookings.paidAt} >= ${since('week')}), 0)::int`,
        month: sql<number>`coalesce(sum(${net}) filter (where ${bookings.paidAt} >= ${since('month')}), 0)::int`,
        total: sql<number>`coalesce(sum(${net}), 0)::int`,
        jobsDone: sql<number>`count(*)::int`,
        duesOwed: duesOwedSql(sql`${helper.id}::uuid`),
      })
      .from(bookings)
      .where(paid);
    const recent = await this.db
      .select({ booking: bookings, title: tasks.title, paymentMethod: tasks.paymentMethod })
      .from(bookings)
      .innerJoin(tasks, eq(bookings.taskId, tasks.id))
      .where(paid)
      .orderBy(desc(bookings.paidAt))
      .limit(20);
    const { cashDuesLimit } = await this.settings.current();
    return {
      today: totals!.today,
      week: totals!.week,
      month: totals!.month,
      total: totals!.total,
      jobsDone: totals!.jobsDone,
      duesOwed: totals!.duesOwed,
      duesLimit: cashDuesLimit,
      overLimit: totals!.duesOwed > cashDuesLimit,
      recent: recent.map(({ booking, title, paymentMethod }) => ({
        bookingId: booking.id,
        title,
        paidAt: booking.paidAt!.toISOString(),
        paymentMethod,
        agreedPrice: booking.agreedPrice,
        commission: booking.commission,
        netAmount: booking.agreedPrice - booking.commission,
      })),
    };
  }

  /** Records that a helper paid everything they owed from cash jobs. Returns the amount settled. */
  async settle(admin: Admin, helperId: string): Promise<number> {
    const [helper] = await this.db
      .select({ id: helperProfiles.id })
      .from(helperProfiles)
      .where(eq(helperProfiles.id, helperId));
    if (!helper) {
      throw new ApiException(404, 'not_found', 'Helper not found.');
    }
    const settled = await this.db
      .update(commissionLedger)
      .set({ settledAt: new Date(), settledBy: admin.id })
      .where(and(eq(commissionLedger.helperId, helperId), isNull(commissionLedger.settledAt)))
      .returning({ amount: commissionLedger.amountDue });
    const amount = settled.reduce((sum, row) => sum + row.amount, 0);
    if (amount === 0) {
      throw new ApiException(409, 'conflict', 'This helper owes nothing.');
    }
    await this.audit.record(admin, 'dues.settle', 'helper', helperId, { amount, entries: settled.length });
    return amount;
  }
}
