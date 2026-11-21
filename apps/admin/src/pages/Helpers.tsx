import { type Helper, SKILL_TAGS, VERIFICATION_LEVELS, formatRupees, normalizeIndianMobile } from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { Applications } from './Applications';

export function Helpers() {
  const queryClient = useQueryClient();
  const helpers = useQuery({ queryKey: ['helpers'], queryFn: api.helpers, refetchInterval: 30_000 });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const canSettle = me.data?.role === 'owner' || me.data?.role === 'finance';
  const settle = useMutation({
    mutationFn: (helper: Helper) => api.settleDues(helper.id).then((result) => ({ ...result, helper })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['helpers'] }),
  });
  const create = useMutation({
    mutationFn: api.createHelper,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['helpers'] }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const phone = normalizeIndianMobile(String(form.get('phone')));
    if (!phone) {
      setPhoneError('Enter a 10-digit Indian mobile number.');
      return;
    }
    setPhoneError(null);
    create.mutate(
      {
        phone,
        name: String(form.get('name')),
        skillTag: form.get('skillTag') as (typeof SKILL_TAGS)[number],
        verificationLevel: form.get('verificationLevel') as (typeof VERIFICATION_LEVELS)[number],
        skills: String(form.get('skills'))
          .split(',')
          .map((skill) => skill.trim())
          .filter(Boolean),
      },
      { onSuccess: () => formElement.reset() },
    );
  }

  const items = helpers.data?.items ?? [];
  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Helpers</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Review people who applied in the app, or add a helper you have checked in person.
        </span>
      </div>

      <Applications />

      {settle.isSuccess ? (
        <p className="notice good">
          Recorded {formatRupees(settle.data.settled)} paid by {settle.data.helper.name ?? settle.data.helper.phone}.
        </p>
      ) : null}
      {settle.isError ? (
        <p className="notice alert" role="alert">
          {settle.error.message}
        </p>
      ) : null}

      <div className="split">
        <section className="card table" aria-label="Helpers">
          <table>
            <thead>
              <tr>
                <th scope="col">Helper</th>
                <th scope="col">Work</th>
                <th scope="col">Verified to</th>
                <th scope="col">Jobs done</th>
                <th scope="col">Cash dues</th>
                <th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              {items.map((helper) => (
                <tr key={helper.id}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{helper.name ?? 'No name yet'}</span>
                      <span className="small muted">{helper.phone}</span>
                    </div>
                  </td>
                  <td>
                    {helper.skillTag === 'skilled'
                      ? `Skilled${helper.skills.length ? `: ${helper.skills.join(', ')}` : ''}`
                      : 'Unskilled'}
                  </td>
                  <td style={{ textTransform: 'capitalize' }}>{helper.verificationLevel}</td>
                  <td>
                    {helper.completedCount}
                    {helper.rating !== null ? <span className="muted"> · rated {helper.rating.toFixed(1)}</span> : null}
                    {helper.cancelledCount ? <span className="muted"> · {helper.cancelledCount} given up</span> : null}
                  </td>
                  <td>
                    {helper.duesOwed === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                        <span>
                          {formatRupees(helper.duesOwed)}
                          {settings.data && helper.duesOwed > settings.data.cashDuesLimit ? (
                            <span className="pill alert" style={{ marginLeft: 6 }}>
                              Over limit
                            </span>
                          ) : null}
                        </span>
                        {canSettle ? (
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={settle.isPending}
                            aria-label={`Record that ${helper.name ?? helper.phone} paid ${formatRupees(helper.duesOwed)}`}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Record that ${helper.name ?? helper.phone} paid ${formatRupees(helper.duesOwed)}?`,
                                )
                              ) {
                                settle.mutate(helper);
                              }
                            }}
                          >
                            Record payment
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td>
                    {helper.status !== 'active' ? (
                      <span className="pill done" style={{ textTransform: 'capitalize' }}>
                        {helper.status}
                      </span>
                    ) : helper.busy ? (
                      <span className="pill live">On a job</span>
                    ) : (
                      <span className="pill waiting">Free</span>
                    )}
                  </td>
                </tr>
              ))}
              {helpers.isSuccess && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'left', padding: '20px 0' }}>
                    No helpers yet. Add the first one with the form.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <form className="card stack" style={{ gap: 14 }} onSubmit={submit} aria-label="Add a helper">
          <h2>Add a helper</h2>
          <label className="field">
            <span>Name</span>
            <input name="name" required maxLength={80} autoComplete="off" />
          </label>
          <label className="field">
            <span>Mobile number</span>
            <input name="phone" type="tel" inputMode="numeric" placeholder="98765 43210" required autoComplete="off" />
          </label>
          <label className="field">
            <span>Kind of work</span>
            <select name="skillTag" defaultValue="unskilled">
              <option value="unskilled">Unskilled: everyday help</option>
              <option value="skilled">Skilled: has a trade</option>
            </select>
          </label>
          <label className="field">
            <span>Trades, if skilled (separate with commas)</span>
            <input name="skills" placeholder="plumbing, electrical" autoComplete="off" />
          </label>
          <label className="field">
            <span>Verified to</span>
            <select name="verificationLevel" defaultValue="verified">
              <option value="basic">Basic: tasks in public places</option>
              <option value="verified">Verified: can enter homes</option>
              <option value="specialised">Specialised: qualification checked</option>
            </select>
          </label>
          {phoneError || create.isError ? (
            <p className="notice alert" role="alert">
              {phoneError ?? create.error?.message}
            </p>
          ) : null}
          {create.isSuccess ? <p className="notice good">{create.data.name ?? 'Helper'} can now take jobs.</p> : null}
          <button className="btn" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add helper'}
          </button>
        </form>
      </div>
    </>
  );
}
