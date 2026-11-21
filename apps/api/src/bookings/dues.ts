import { type SQL, sql } from 'drizzle-orm';

/** Commission helper `helperId` owes from cash jobs and has not paid, in paise, as SQL. */
export const duesOwedSql = (helperId: SQL) =>
  sql<number>`(select coalesce(sum(cl.amount_due), 0)::int from commission_ledger cl where cl.helper_id = ${helperId} and cl.settled_at is null)`;
