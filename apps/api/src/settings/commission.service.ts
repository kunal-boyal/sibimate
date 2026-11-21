import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import type { Admin, CommissionSettings, SetCommissionRate } from '@sibimate/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../admin/audit.service.js';
import { ApiException } from '../common/api-exception.js';
import type { Database } from '../db/db.js';
import { adminUsers, commissionRules, taskCategories } from '../db/schema.js';
import { commissionRateSql } from './commission-rate.js';

/**
 * Commission rates: a default, and a rate of its own for any category. A change
 * applies to bookings confirmed after it; each booking keeps the rate it was confirmed at.
 */
@Injectable()
export class CommissionService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<CommissionSettings> {
    const [current] = await this.db
      .execute<{ rate: number }>(sql`select ${commissionRateSql(sql`null`)} as rate`)
      .then((result) => result.rows);
    // Each active category's latest row, if it has one. The column is written out in full: in a
    // one-table query Drizzle leaves it bare, and inside the subquery that would mean cr.id.
    const categories = await this.db
      .select({
        categoryId: taskCategories.id,
        name: taskCategories.name,
        rateBps: sql<
          number | null
        >`(select cr.rate_bps from commission_rules cr where cr.category_id = task_categories.id order by cr.effective_from desc limit 1)`,
      })
      .from(taskCategories)
      .where(eq(taskCategories.active, true))
      .orderBy(asc(taskCategories.name));
    const history = await this.db
      .select({
        categoryName: taskCategories.name,
        rateBps: commissionRules.rateBps,
        effectiveFrom: commissionRules.effectiveFrom,
        changedBy: adminUsers.email,
      })
      .from(commissionRules)
      .leftJoin(taskCategories, eq(commissionRules.categoryId, taskCategories.id))
      .leftJoin(adminUsers, eq(commissionRules.changedBy, adminUsers.id))
      .orderBy(desc(commissionRules.effectiveFrom))
      .limit(30);
    return {
      defaultBps: current!.rate,
      categories,
      history: history.map((row) => ({ ...row, effectiveFrom: row.effectiveFrom.toISOString() })),
    };
  }

  async set(admin: Admin, { categoryId, rateBps }: SetCommissionRate): Promise<CommissionSettings> {
    if (categoryId) {
      const [category] = await this.db
        .select({ id: taskCategories.id })
        .from(taskCategories)
        .where(and(eq(taskCategories.id, categoryId), eq(taskCategories.active, true)));
      if (!category) {
        throw new ApiException(400, 'validation_failed', 'Validation failed', [
          { path: 'categoryId', message: 'Choose an active category.' },
        ]);
      }
    }
    const before = await this.get();
    const previous = categoryId
      ? (before.categories.find((category) => category.categoryId === categoryId)?.rateBps ?? null)
      : before.defaultBps;
    if (previous === rateBps) {
      return before;
    }
    await this.db.insert(commissionRules).values({ categoryId, rateBps, changedBy: admin.id });
    await this.audit.record(admin, 'commission.change', 'task_category', categoryId ?? 'default', {
      before: previous,
      after: rateBps,
    });
    return this.get();
  }
}
