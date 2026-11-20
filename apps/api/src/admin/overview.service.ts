import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { type AdminOverview, HELPER_SEEN_SECONDS } from '@sibimate/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.js';

/** Days start at midnight in India, whatever the server's clock is set to. */
const TODAY = sql`(date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')`;

/** The figures on the dashboard's overview page. */
@Injectable()
export class OverviewService {
  constructor(@InjectDrizzle() private readonly db: Database) {}

  async get(): Promise<AdminOverview> {
    const int = (value: unknown) => Number(value ?? 0);
    const [
      {
        rows: [today],
      },
      {
        rows: [now],
      },
      {
        rows: [fulfilment],
      },
      { rows: days },
    ] = await Promise.all([
      this.db.execute(sql`
        select
          (select count(*) from tasks where created_at >= ${TODAY}) as posted,
          count(*) as paid,
          coalesce(sum(agreed_price), 0) as value,
          coalesce(sum(commission), 0) as commission
        from bookings where status = 'completed' and paid_at >= ${TODAY}`),
      this.db.execute(sql`
        select
          (select count(*) from tasks where status = 'matching') as looking,
          (select count(*) from tasks where status in ('assigned', 'en_route', 'in_progress', 'completed')) as under_way,
          (select count(*) from tasks where status = 'expired') as expired,
          (select count(*) from helper_availability
             where is_online and seen_at > now() - make_interval(secs => ${HELPER_SEEN_SECONDS})) as online,
          (select count(*) from helper_profiles where status = 'pending') as applications,
          (select count(*) from disputes where status = 'open') as disputes`),
      // A task counts once it has found a helper or given up looking; tasks still looking or cancelled while looking do not.
      this.db.execute(sql`
        select
          count(*) filter (where exists (select 1 from bookings b where b.task_id = t.id)) as matched,
          count(*) filter (where exists (select 1 from bookings b where b.task_id = t.id) or t.status = 'expired') as total
        from tasks t where t.created_at >= ${TODAY} - interval '6 days'`),
      this.db.execute(sql`
        select to_char(day, 'YYYY-MM-DD') as day, count(t.id) as count
        from generate_series(${TODAY} - interval '6 days', ${TODAY}, interval '1 day') as day
        left join tasks t on t.created_at >= day and t.created_at < day + interval '1 day'
        group by day order by day`),
    ]);
    return {
      today: {
        posted: int(today?.posted),
        paid: int(today?.paid),
        value: int(today?.value),
        commission: int(today?.commission),
      },
      now: {
        lookingForHelper: int(now?.looking),
        underWay: int(now?.under_way),
        expired: int(now?.expired),
        helpersOnline: int(now?.online),
        applicationsWaiting: int(now?.applications),
        openDisputes: int(now?.disputes),
      },
      fulfilment: { matched: int(fulfilment?.matched), total: int(fulfilment?.total) },
      postedByDay: days.map((row) => ({ day: String(row.day), count: int(row.count) })),
    };
  }
}
