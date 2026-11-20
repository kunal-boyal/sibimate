import { formatRupees } from '@sibimate/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api';

const dayName = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });

/** Today's work, what needs attention now, and the last week. */
export function Overview() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: api.overview, refetchInterval: 30_000 });
  const data = overview.data;
  const rate =
    data && data.fulfilment.total > 0 ? Math.round((100 * data.fulfilment.matched) / data.fulfilment.total) : null;
  const most = data ? Math.max(1, ...data.postedByDay.map((day) => day.count)) : 1;

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Overview</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Today runs from midnight in India. Figures update by themselves.
        </span>
      </div>
      {overview.isError ? (
        <p className="notice alert" role="alert">
          {overview.error.message}
        </p>
      ) : null}
      {data ? (
        <>
          <section aria-label="Needs attention" className="stats">
            <Stat label="Looking for a helper" value={data.now.lookingForHelper} to="/bookings" />
            <Stat label="No helper found" value={data.now.expired} to="/bookings" alert={data.now.expired > 0} />
            <Stat
              label="Open disputes"
              value={data.now.openDisputes}
              to="/disputes"
              alert={data.now.openDisputes > 0}
            />
            <Stat label="Applications to review" value={data.now.applicationsWaiting} to="/helpers" />
          </section>
          <section aria-label="Today" className="stats">
            <Stat label="Tasks posted today" value={data.today.posted} />
            <Stat label="Jobs paid today" value={data.today.paid} />
            <Stat label="Value paid today" value={formatRupees(data.today.value)} />
            <Stat label="Commission today" value={formatRupees(data.today.commission)} brand />
          </section>
          <section aria-label="Right now" className="stats">
            <Stat label="Jobs under way" value={data.now.underWay} />
            <Stat label="Helpers online" value={data.now.helpersOnline} />
            <Stat
              label="Found a helper, last 7 days"
              value={rate === null ? '–' : `${rate}%`}
              note={`${data.fulfilment.matched} of ${data.fulfilment.total} tasks`}
              alert={rate !== null && rate < 70}
            />
          </section>
          <section className="card stack" style={{ gap: 12 }} aria-labelledby="by-day">
            <h2 id="by-day">Tasks posted, last 7 days</h2>
            <ol className="bars">
              {data.postedByDay.map((day) => (
                <li key={day.day}>
                  <span className="small muted">{dayName(day.day)}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${(100 * day.count) / most}%` }} />
                  </span>
                  <span className="strong">{day.count}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}
    </>
  );
}

function Stat(props: {
  label: string;
  value: number | string;
  note?: string;
  to?: string;
  alert?: boolean;
  brand?: boolean;
}) {
  const body = (
    <>
      <span className="small muted">{props.label}</span>
      <span className="stat-value">{props.value}</span>
      {props.note ? <span className="small muted">{props.note}</span> : null}
    </>
  );
  const className = `card stat${props.alert ? ' alert' : ''}${props.brand ? ' brand' : ''}`;
  return props.to ? (
    <Link to={props.to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
