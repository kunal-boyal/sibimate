import type { AdminCustomer } from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '../api';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Everyone who has signed in to the app, with their tasks, and blocking for accounts that misuse it. */
export function Customers() {
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customers = useQuery({ queryKey: ['customers', q], queryFn: () => api.customers(q) });
  const items = customers.data?.items ?? [];
  const selected = items.find((customer) => customer.id === selectedId) ?? null;

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Customers</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Everyone who has signed in to the app, newest first. Helpers are customers too.
        </span>
      </div>

      <label className="field" style={{ maxWidth: 360 }}>
        <span>Find by name or phone number</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={60} />
      </label>

      {customers.isError ? (
        <p className="notice alert" role="alert">
          {customers.error.message}
        </p>
      ) : null}

      <div className="split">
        <section className="card table" aria-label="Customers">
          <table>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Joined</th>
                <th scope="col">Tasks</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((customer) => (
                <tr key={customer.id} className={customer.id === selectedId ? 'selected' : undefined}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{customer.name ?? 'No name given'}</span>
                      <span className="small muted">
                        {customer.phone}
                        {customer.isHelper ? ' · helper' : ''}
                      </span>
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{date(customer.joinedAt)}</td>
                  <td>
                    {customer.tasks.total}
                    {customer.tasks.open ? <span className="small muted"> · {customer.tasks.open} open</span> : null}
                  </td>
                  <td>
                    <span className={`pill ${customer.status === 'blocked' ? 'alert' : 'done'}`}>
                      {customer.status === 'blocked' ? 'Blocked' : 'Active'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-label={`Open ${customer.name ?? customer.phone}`}
                      onClick={() => setSelectedId(customer.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {customers.isSuccess && items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'left', padding: '20px 0' }}>
                    {q ? 'Nobody matches that.' : 'Nobody has signed up yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        {selected ? <CustomerPanel key={selected.id} customer={selected} /> : null}
      </div>
    </>
  );
}

function CustomerPanel({ customer }: { customer: AdminCustomer }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const canBlock = me.data?.role === 'owner' || me.data?.role === 'operations';
  const [reason, setReason] = useState('');
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    ]);
  const block = useMutation({ mutationFn: () => api.blockCustomer(customer.id, reason.trim()), onSuccess: refresh });
  const unblock = useMutation({ mutationFn: () => api.unblockCustomer(customer.id), onSuccess: refresh });
  const blocked = customer.status === 'blocked';

  return (
    <section className="card stack" style={{ gap: 16 }} aria-live="polite" aria-label="Selected customer">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <h2>{customer.name ?? 'No name given'}</h2>
        <span className={`pill ${blocked ? 'alert' : 'done'}`}>{blocked ? 'Blocked' : 'Active'}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>Phone</dt>
          <dd>{customer.phone}</dd>
        </div>
        <div>
          <dt>Language</dt>
          <dd>{customer.language === 'hi' ? 'Hindi' : 'English'}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{date(customer.joinedAt)}</dd>
        </div>
        <div>
          <dt>Last task</dt>
          <dd>{customer.lastTaskAt ? date(customer.lastTaskAt) : 'None yet'}</dd>
        </div>
        <div>
          <dt>Tasks</dt>
          <dd>
            {customer.tasks.total} posted · {customer.tasks.done} done
          </dd>
        </div>
        <div>
          <dt>Open · cancelled</dt>
          <dd>
            {customer.tasks.open} · {customer.tasks.cancelled}
          </dd>
        </div>
        {customer.isHelper ? (
          <div className="wide">
            <dt>Also a helper</dt>
            <dd>Blocking also takes them offline and stops them being shown tasks.</dd>
          </div>
        ) : null}
        {blocked && customer.blockedReason ? (
          <div className="wide">
            <dt>Blocked because</dt>
            <dd>{customer.blockedReason}</dd>
          </div>
        ) : null}
      </dl>

      {block.isSuccess ? (
        <p className="notice good">
          Blocked and signed out.
          {block.data.cancelledTasks
            ? ` ${block.data.cancelledTasks} task${block.data.cancelledTasks === 1 ? '' : 's'} nobody had taken ${block.data.cancelledTasks === 1 ? 'was' : 'were'} cancelled.`
            : ''}
        </p>
      ) : null}
      {unblock.isSuccess ? <p className="notice good">Unblocked. They can sign in again.</p> : null}
      {[block, unblock].map((mutation, index) =>
        mutation.isError ? (
          <p key={index} className="notice alert" role="alert">
            {mutation.error.message}
          </p>
        ) : null,
      )}

      {!canBlock ? null : blocked ? (
        <button
          type="button"
          className="btn secondary"
          disabled={unblock.isPending}
          onClick={() => unblock.mutate()}
        >
          {unblock.isPending ? 'Unblocking…' : 'Unblock account'}
        </button>
      ) : (
        <form
          className="stack"
          style={{ gap: 12, borderTop: '1px solid var(--border)', paddingTop: 16 }}
          onSubmit={(event) => {
            event.preventDefault();
            block.mutate();
          }}
        >
          <p className="small muted">
            Blocking signs them out on every phone and stops them signing in. Tasks nobody has taken are cancelled. It
            waits until any job under way is settled.
          </p>
          <label className="field">
            <span>Why are you blocking this account?</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={300} required />
          </label>
          <button className="btn danger" type="submit" disabled={reason.trim().length < 5 || block.isPending}>
            {block.isPending ? 'Blocking…' : 'Block account'}
          </button>
        </form>
      )}
    </section>
  );
}
