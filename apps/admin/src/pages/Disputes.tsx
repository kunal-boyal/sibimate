import { type AdminDispute, type DisputeResolution, formatRupees } from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';

const STAGE: Record<string, string> = {
  in_progress: 'during the work',
  completed: 'after the work, before payment',
  paid: 'after payment',
};

export function Disputes() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const disputes = useQuery({
    queryKey: ['disputes', status],
    queryFn: () => api.disputes(status),
    refetchInterval: 30_000,
  });
  const items = disputes.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Disputes</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Problems reported by customers or helpers. Talk to both sides, then decide what is owed.
        </span>
      </div>
      <div className="chips">
        {(['open', 'resolved'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setSelectedId(null);
            }}
          >
            {value === 'open' ? 'Open' : 'Decided'}
            {status === value && disputes.data ? ` · ${items.length}` : ''}
          </button>
        ))}
      </div>
      {disputes.isError ? (
        <p className="notice alert" role="alert">
          {disputes.error.message}
        </p>
      ) : null}
      <div className="split">
        <section className="card table" aria-label="Disputes">
          <table>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Raised by</th>
                <th scope="col">Value</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.id === selectedId ? 'selected' : undefined}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{item.task.title}</span>
                      <span className="small muted">Raised {STAGE[item.previousStatus] ?? ''}</span>
                    </div>
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{item.raisedBy}</td>
                  <td className="strong">{formatRupees(item.agreedPrice)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-label={`Open dispute about ${item.task.title}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {disputes.isSuccess && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted" style={{ textAlign: 'left', padding: '20px 0' }}>
                    {status === 'open' ? 'No open disputes.' : 'No disputes decided yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
        {selected ? <DisputePanel key={selected.id} dispute={selected} /> : null}
      </div>
    </>
  );
}

function DisputePanel({ dispute }: { dispute: AdminDispute }) {
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState<DisputeResolution | ''>('');
  const resolve = useMutation({
    mutationFn: (note: string) => api.resolveDispute(dispute.id, resolution as DisputeResolution, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resolve.mutate(String(new FormData(event.currentTarget).get('note')));
  }

  return (
    <section className="card stack" style={{ gap: 16 }} aria-label="Selected dispute">
      <h2>{dispute.task.title}</h2>
      <blockquote className="notice neutral" style={{ margin: 0 }}>
        <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>
          The {dispute.raisedBy} wrote:
        </span>
        {dispute.reason}
      </blockquote>
      <dl className="facts">
        <div>
          <dt>Customer</dt>
          <dd>
            {dispute.customer.name ? `${dispute.customer.name} · ` : ''}
            <a href={`tel:${dispute.customer.phone}`}>{dispute.customer.phone}</a>
          </dd>
        </div>
        <div>
          <dt>Helper</dt>
          <dd>
            {dispute.helper.name ? `${dispute.helper.name} · ` : ''}
            <a href={`tel:${dispute.helper.phone}`}>{dispute.helper.phone}</a>
          </dd>
        </div>
        <div>
          <dt>Agreed price</dt>
          <dd>
            {formatRupees(dispute.agreedPrice)} · {dispute.paymentMethod === 'cash' ? 'cash' : 'UPI'}
          </dd>
        </div>
        <div>
          <dt>Raised</dt>
          <dd>{new Date(dispute.createdAt).toLocaleString('en-IN')}</dd>
        </div>
        <div className="wide">
          <dt>Address</dt>
          <dd>{dispute.task.address}</dd>
        </div>
      </dl>

      {dispute.status === 'resolved' ? (
        <p className="notice good">
          {dispute.resolution === 'release' ? 'Helper paid in full.' : 'Customer owes nothing.'}{' '}
          {dispute.resolutionNote}
        </p>
      ) : (
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <fieldset className="stack" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="small strong muted" style={{ marginBottom: 8 }}>
              Decision
            </legend>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'release'}
                onChange={() => setResolution('release')}
              />
              The helper is paid in full
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="radio"
                name="resolution"
                checked={resolution === 'refund'}
                onChange={() => setResolution('refund')}
              />
              The customer owes nothing
            </label>
          </fieldset>
          <label className="field">
            <span>Note, shown to both sides</span>
            <input name="note" required minLength={5} maxLength={500} placeholder="What you found and why" />
          </label>
          {dispute.paymentMethod === 'cash' ? (
            <p className="small muted">This was a cash job: no money moves in the app. Tell both sides what to do.</p>
          ) : null}
          {resolve.isError ? (
            <p className="notice alert" role="alert">
              {resolve.error.message}
            </p>
          ) : null}
          <button
            className="btn"
            type="submit"
            disabled={!resolution || resolve.isPending}
            style={{ alignSelf: 'flex-start' }}
          >
            {resolve.isPending ? 'Saving…' : 'Decide and close'}
          </button>
        </form>
      )}
    </section>
  );
}
