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
    </>
  );
}
