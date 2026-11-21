import { type PlatformSettings, formatRupees } from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';

/** Each setting, how it is entered, and how it is stored. Money is entered in rupees and stored in paise. */
const FIELDS: { key: keyof PlatformSettings; label: string; help: string; unit: string; scale: number }[] = [
  {
    key: 'cancellationFee',
    label: 'Cancellation fee',
    help: 'Paid to the helper when a customer cancels after the helper has set off.',
    unit: '₹',
    scale: 100,
  },
  {
    key: 'cashDuesLimit',
    label: 'Cash dues limit',
    help: 'Unpaid commission from cash jobs above which a helper is shown only online-payment tasks.',
    unit: '₹',
    scale: 100,
  },
  {
    key: 'disputeWindowHours',
    label: 'Dispute window',
    help: 'How long after a job either side can raise a dispute.',
    unit: 'hours',
    scale: 1,
  },
  {
    key: 'completionCodeWaitMinutes',
    label: 'Completion code wait',
    help: 'How long a helper waits for the completion code before an admin is alerted.',
    unit: 'minutes',
    scale: 1,
  },
];

export function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const canEdit = me.data?.role === 'owner' || me.data?.role === 'finance';
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setSaved(true);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    save.mutate(
      Object.fromEntries(
        FIELDS.map(({ key, scale }) => [key, Math.round(Number(form.get(key)) * scale)]),
      ) as PlatformSettings,
    );
  }

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Settings</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Rules that apply to every task. A change takes effect at once and is recorded with its old value.
        </span>
      </div>

      {settings.isError ? (
        <p className="notice alert" role="alert">
          {settings.error.message}
        </p>
      ) : null}
      {settings.data ? (
        <form
          className="card stack"
          style={{ gap: 18, maxWidth: 560 }}
          onSubmit={submit}
          aria-label="Platform settings"
        >
          {FIELDS.map(({ key, label, help, unit, scale }) => (
            <label key={key} className="field">
              <span>
                {label} {unit === '₹' ? '(₹)' : `(${unit})`}
              </span>
              <input
                name={key}
                type="number"
                inputMode="numeric"
                min={0}
                step={unit === '₹' ? 1 : 1}
                required
                disabled={!canEdit}
                defaultValue={settings.data[key] / scale}
                aria-describedby={`${key}-help`}
              />
              <span id={`${key}-help`} className="small muted" style={{ fontWeight: 400 }}>
                {help}
                {unit === '₹' ? ` Now ${formatRupees(settings.data[key])}.` : ''}
              </span>
            </label>
          ))}
          {save.isError ? (
            <p className="notice alert" role="alert">
              {save.error.message}
            </p>
          ) : null}
          {saved ? <p className="notice good">Saved. The new values apply from now on.</p> : null}
          {canEdit ? (
            <button className="btn" type="submit" disabled={save.isPending} style={{ alignSelf: 'flex-start' }}>
              {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          ) : (
            <p className="notice neutral">Only owners and the finance role can change these.</p>
          )}
          <p className="small muted">
            {settings.data.updatedBy
              ? `Last changed by ${settings.data.updatedBy} on ${new Date(settings.data.updatedAt!).toLocaleString('en-IN')}.`
              : 'These are the starting values; nobody has changed them yet.'}
          </p>
        </form>
      ) : null}

      <Commission canEdit={canEdit} />
    </>
  );
}

const percent = (bps: number) => `${bps / 100}%`;

/** The default commission rate and any category's own rate, with the latest changes. */
function Commission({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const commission = useQuery({ queryKey: ['commission'], queryFn: api.commission });
  const [target, setTarget] = useState('');
  const [rate, setRate] = useState('');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: api.setCommission,
    onMutate: () => setSaved(false),
    onSuccess: (data) => {
      queryClient.setQueryData(['commission'], data);
      setRate('');
      setSaved(true);
    },
  });
  const data = commission.data;
  if (commission.isError) {
    return (
      <p className="notice alert" role="alert">
        {commission.error.message}
      </p>
    );
  }
  if (!data) {
    return null;
  }
  const categoryId = target || null;
  const withOwn = data.categories.filter((category) => category.rateBps !== null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({ categoryId, rateBps: rate.trim() === '' ? null : Math.round(Number(rate) * 100) });
  }

  return (
    <section className="card stack" style={{ gap: 18, maxWidth: 560 }} aria-label="Commission">
      <div className="stack" style={{ gap: 4 }}>
        <h2>Commission</h2>
        <span className="small muted">
          Taken from the agreed price of each job. A change applies to helpers confirmed from now on; jobs already
          booked keep their rate.
        </span>
      </div>
      <dl className="facts">
        <div>
          <dt>Default</dt>
          <dd>{percent(data.defaultBps)}</dd>
        </div>
        {withOwn.map((category) => (
          <div key={category.categoryId}>
            <dt>{category.name}</dt>
            <dd>{percent(category.rateBps!)}</dd>
          </div>
        ))}
      </dl>
      {withOwn.length === 0 ? <p className="small muted">Every category uses the default.</p> : null}

      {canEdit ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={submit} aria-label="Change a commission rate">
          <label className="field">
            <span>Rate for</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Every category without its own rate (default)</option>
              {data.categories.map((category) => (
                <option key={category.categoryId} value={category.categoryId}>
                  {category.name}
                  {category.rateBps === null ? '' : ` · now ${percent(category.rateBps)}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>New rate (%)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={0.01}
              value={rate}
              onChange={(event) => setRate(event.target.value)}
              required={categoryId === null}
              aria-describedby="rate-help"
            />
            <span id="rate-help" className="small muted" style={{ fontWeight: 400 }}>
              {categoryId === null
                ? 'Up to 50%.'
                : 'Up to 50%. Leave it empty to put this category back on the default.'}
            </span>
          </label>
          {save.isError ? (
            <p className="notice alert" role="alert">
              {save.error.message}
            </p>
          ) : null}
          {saved ? <p className="notice good">Saved. It applies to helpers confirmed from now on.</p> : null}
          <button className="btn" type="submit" disabled={save.isPending} style={{ alignSelf: 'flex-start' }}>
            {save.isPending ? 'Saving…' : 'Save rate'}
          </button>
        </form>
      ) : (
        <p className="notice neutral">Only owners and the finance role can change commission.</p>
      )}

      {data.history.length > 0 ? (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ fontSize: 14 }}>Changes</h3>
          <ul className="stack small" style={{ gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>
            {data.history.slice(0, 10).map((row) => (
              <li key={`${row.effectiveFrom}-${row.categoryName}`}>
                {new Date(row.effectiveFrom).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}:{' '}
                {row.categoryName ?? 'Default'}{' '}
                {row.rateBps === null ? 'back on the default' : `set to ${percent(row.rateBps)}`}
                {row.changedBy ? <span className="muted"> · {row.changedBy}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
