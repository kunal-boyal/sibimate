import { DEFAULT_COMMISSION_BPS } from '@sibimate/shared';
import { type SQL, sql } from 'drizzle-orm';

/**
 * The commission rate in force for a task in `category`, as SQL: the category's own
 * latest rate, else the latest default, else DEFAULT_COMMISSION_BPS.
 */
export const commissionRateSql = (category: SQL) => sql<number>`coalesce(
  (select cr.rate_bps from commission_rules cr where cr.category_id = ${category} order by cr.effective_from desc limit 1),
  (select cr.rate_bps from commission_rules cr where cr.category_id is null order by cr.effective_from desc limit 1),
  ${DEFAULT_COMMISSION_BPS}
)::int`;
