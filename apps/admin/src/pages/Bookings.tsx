import {
  type AdminTask,
  DEFAULT_COMMISSION_BPS,
  SEARCH_AREA_STEPS_M,
  type TaskStatus,
  commissionFor,
  formatRupees,
} from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';

const FILTERS = [
  ['unassigned', 'Needs a helper'],
  ['active', 'Under way'],
  ['all', 'All'],
] as const;

const STATUS: Record<TaskStatus, { label: string; tone: 'live' | 'waiting' | 'alert' | 'done' }> = {
  draft: { label: 'Draft', tone: 'done' },
  posted: { label: 'Posted', tone: 'waiting' },
  matching: { label: 'Needs a helper', tone: 'waiting' },
  assigned: { label: 'Helper confirmed', tone: 'live' },
  en_route: { label: 'Helper on the way', tone: 'live' },
  in_progress: { label: 'Work under way', tone: 'live' },
  completed: { label: 'Completed, unpaid', tone: 'live' },
  paid: { label: 'Paid', tone: 'done' },
  closed: { label: 'Closed', tone: 'done' },
  expired: { label: 'No helper found', tone: 'alert' },
  cancelled: { label: 'Cancelled', tone: 'done' },
  disputed: { label: 'Disputed', tone: 'alert' },
};

const posted = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill ${STATUS[status].tone}`}>{STATUS[status].label}</span>;
}

export function Bookings() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('unassigned');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Live updates refresh the list at once; the slow timer covers a dropped connection.
  const tasks = useQuery({ queryKey: ['tasks', filter], queryFn: () => api.tasks(filter), refetchInterval: 30_000 });
  const items = tasks.data?.items ?? [];
  const selected = items.find((task) => task.id === selectedId) ?? null;

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Bookings</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Every task from posting to payment. Assign a helper to the ones that need one.
        </span>
      </div>

      <div className="chips">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setSelectedId(null);
            }}
          >
            {label}
            {filter === value && tasks.data ? ` · ${items.length}` : ''}
          </button>
        ))}
      </div>

      {tasks.isError ? (
        <p className="notice alert" role="alert">
          {tasks.error.message}
        </p>
      ) : null}

      <div className="split">
        <section className="card table" aria-label="Tasks">
          <table>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Customer</th>
                <th scope="col">Helper</th>
                <th scope="col">Status</th>
                <th scope="col">Value</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((task) => (
                <tr key={task.id} className={task.id === selectedId ? 'selected' : undefined}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{task.title}</span>
                      <span className="small muted">
                        {task.category?.name ?? 'No category'} · posted {posted(task.createdAt)}
                      </span>
                    </div>
                  </td>
                  <td>{task.customer.name ?? task.customer.phone}</td>
                  <td>
                    {task.helper ? (task.helper.name ?? task.helper.phone) : <span className="muted">None yet</span>}
                  </td>
                  <td>
                    <StatusPill status={task.status} />
                  </td>
                  <td className="strong">{formatRupees(task.customerPrice)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-label={`Open ${task.title}`}
                      onClick={() => setSelectedId(task.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {tasks.isSuccess && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'left', padding: '20px 0' }}>
                    {filter === 'unassigned' ? 'No task is waiting for a helper.' : 'Nothing here yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {selected ? <TaskPanel key={selected.id} task={selected} /> : null}
      </div>
    </>
  );
}

function TaskPanel({ task }: { task: AdminTask }) {
  const queryClient = useQueryClient();
  const helpers = useQuery({ queryKey: ['helpers'], queryFn: api.helpers });
  const free = (helpers.data?.items ?? []).filter((helper) => helper.status === 'active' && !helper.busy);
  const [helperId, setHelperId] = useState('');
  const assign = useMutation({
    mutationFn: () => api.assign(task.id, helperId),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['helpers'] }),
      ]),
  });
  // An admin can give a helper a task still looking, or one whose search ended with nobody.
  const canAssign = task.status === 'matching' || task.status === 'expired';

  return (
    <section className="card stack" style={{ gap: 16 }} aria-live="polite" aria-label="Selected task">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2>{task.title}</h2>
        <StatusPill status={task.status} />
      </div>
      <p style={{ fontSize: 14, lineHeight: '20px' }}>{task.description}</p>
      <dl className="facts">
        <div>
          <dt>Customer</dt>
          <dd>
            {task.customer.name ? `${task.customer.name} · ` : ''}
            {task.customer.phone}
          </dd>
        </div>
        <div>
          <dt>Task value</dt>
          <dd>
            {formatRupees(task.customerPrice)} · {task.paymentMethod === 'cash' ? 'cash' : 'UPI'}
          </dd>
        </div>
        <div>
          <dt>Helper</dt>
          <dd>{task.helper ? `${task.helper.name ?? 'Helper'} · ${task.helper.phone}` : 'None yet'}</dd>
        </div>
        <div>
          <dt>Commission at {DEFAULT_COMMISSION_BPS / 100}%</dt>
          <dd>{formatRupees(commissionFor(task.customerPrice, DEFAULT_COMMISSION_BPS))}</dd>
        </div>
        <div>
          <dt>Needs</dt>
          <dd>
            {task.helpersNeeded === 1 ? '1 person' : `${task.helpersNeeded} people`}
            {task.requiresSkilled ? ' · skilled work' : ''}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{task.scheduleAt ? posted(task.scheduleAt) : 'Right now'}</dd>
        </div>
        <div className="wide">
          <dt>Address</dt>
          <dd>{task.address}</dd>
        </div>
      </dl>
      {task.needsReview ? (
        <p className="notice neutral">
          Marked for review: the task details were not written by AI with confidence, or its category is new or missing.
        </p>
      ) : null}

      {canAssign ? (
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate();
          }}
        >
          <label className="field">
            <span>Assign a helper</span>
            <select value={helperId} onChange={(event) => setHelperId(event.target.value)} required>
              <option value="">{free.length ? 'Choose a free helper' : 'No helper is free'}</option>
              {free.map((helper) => (
                <option key={helper.id} value={helper.id}>
                  {helper.name ?? helper.phone} · {helper.skillTag} · {helper.verificationLevel}
                </option>
              ))}
            </select>
          </label>
          {assign.isError ? (
            <p className="notice alert" role="alert">
              {assign.error.message}
            </p>
          ) : null}
          <button className="btn" type="submit" disabled={!helperId || assign.isPending}>
            {assign.isPending ? 'Assigning…' : 'Assign helper'}
          </button>
        </form>
      ) : null}
      {assign.isSuccess ? <p className="notice good">Helper assigned. They can see the job in the app now.</p> : null}
      {canAssign && !assign.isSuccess ? <WidenSearch task={task} /> : null}
    </section>
  );
}

const km = (metres: number) => `${metres / 1000} km`;

/** Searches further for a task no helper has taken. An expired task starts looking again. */
function WidenSearch({ task }: { task: AdminTask }) {
  const queryClient = useQueryClient();
  const larger = SEARCH_AREA_STEPS_M.filter((step) => step > task.searchRadiusM);
  const [chosen, setChosen] = useState<number | null>(null);
  // After a widening the list refreshes, and a choice no longer larger falls back to the next step.
  const radiusM = chosen !== null && larger.some((step) => step === chosen) ? chosen : (larger[0] ?? '');
  const widen = useMutation({
    mutationFn: () => api.widen(task.id, Number(radiusM)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <form
      className="stack"
      style={{ gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}
      onSubmit={(event) => {
        event.preventDefault();
        widen.mutate();
      }}
    >
      <p className="small muted">
        {task.status === 'expired'
          ? `The search reached ${km(task.searchRadiusM)} and found nobody. Searching again tells helpers further away, and those shown it before.`
          : `Searching within ${km(task.searchRadiusM)} of the customer.`}
      </p>
      {larger.length === 0 ? (
        <p className="small muted">This is the widest search there is.</p>
      ) : (
        <>
          <label className="field">
            <span>{task.status === 'expired' ? 'Search again within' : 'Widen the search to'}</span>
            <select value={radiusM} onChange={(event) => setChosen(Number(event.target.value))} required>
              {larger.map((step) => (
                <option key={step} value={step}>
                  {km(step)}
                </option>
              ))}
            </select>
          </label>
          {widen.isError ? (
            <p className="notice alert" role="alert">
              {widen.error.message}
            </p>
          ) : null}
          {widen.isSuccess ? <p className="notice good">Search widened. Helpers in the new area can see the task now.</p> : null}
          <button className="btn secondary" type="submit" disabled={radiusM === '' || widen.isPending}>
            {widen.isPending ? 'Widening…' : task.status === 'expired' ? 'Search again' : 'Widen search'}
          </button>
        </>
      )}
    </form>
  );
}
