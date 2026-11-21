import { type AdminCategory, VERIFICATION_LEVELS, type VerificationLevel } from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../api';
import { LEVELS } from '../levels';

/** The categories tasks are filed under, and the ones the AI proposed that wait for a decision. */
export function Categories() {
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories });
  const items = categories.data?.items ?? [];
  const pending = items.filter((item) => item.reviewStatus === 'pending');
  const active = items.filter((item) => item.active);

  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Categories</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          When no category fits a task, the AI proposes a new one. Approve it, or fold it into one that exists.
        </span>
      </div>
      {categories.isError ? (
        <p className="notice alert" role="alert">
          {categories.error.message}
        </p>
      ) : null}

      <h2>Proposed by the AI · {pending.length}</h2>
      {categories.isSuccess && pending.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
      <div className="stack" style={{ gap: 16 }}>
        {pending.map((item) => (
          <Proposal key={item.id} category={item} active={active} />
        ))}
      </div>

      <h2>In use · {active.length}</h2>
      <section className="card table" aria-label="Categories in use">
        <table>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Work</th>
              <th scope="col">Helpers need</th>
              <th scope="col">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {active.map((item) => (
              <tr key={item.id}>
                <td className="strong">{item.name}</td>
                <td>{item.requiresSkilled ? 'Skilled' : 'Everyday'}</td>
                <td>{LEVELS[item.minVerificationLevel]}</td>
                <td>{item.taskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Proposal({ category, active }: { category: AdminCategory; active: AdminCategory[] }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'approve' | 'merge'>('approve');
  const done = () => queryClient.invalidateQueries({ queryKey: ['categories'] });
  const approve = useMutation({
    mutationFn: (form: FormData) =>
      api.approveCategory(category.id, {
        name: String(form.get('name')),
        requiresSkilled: form.get('skilled') === 'on',
        minVerificationLevel: form.get('level') as VerificationLevel,
      }),
    onSuccess: done,
  });
  const merge = useMutation({
    mutationFn: (intoId: string) => api.mergeCategory(category.id, intoId),
    onSuccess: done,
  });
  const error = approve.error ?? merge.error;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === 'approve') {
      approve.mutate(form);
    } else {
      merge.mutate(String(form.get('into')));
    }
  }

  return (
    <form
      className="card stack"
      style={{ gap: 14 }}
      onSubmit={submit}
      aria-label={`Proposed category ${category.name}`}
    >
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <span className="strong" style={{ fontSize: 17 }}>
          {category.name}
        </span>
        <span className="small muted">
          {category.taskCount} {category.taskCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>
      <div className="chips">
        <button type="button" className="chip" aria-pressed={mode === 'approve'} onClick={() => setMode('approve')}>
          Approve
        </button>
        <button type="button" className="chip" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>
          Merge into another
        </button>
      </div>
      {mode === 'approve' ? (
        <>
          <label className="field">
            <span>Name</span>
            <input name="name" defaultValue={category.name} required minLength={2} maxLength={60} />
          </label>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" name="skilled" defaultChecked={category.requiresSkilled} />
            Skilled work
          </label>
          <label className="field">
            <span>Helpers need to be</span>
            <select name="level" defaultValue="verified">
              {VERIFICATION_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVELS[level]}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <label className="field">
          <span>Move its tasks into</span>
          <select name="into" required defaultValue="">
            <option value="" disabled>
              Choose a category
            </option>
            {active.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error ? (
        <p className="notice alert" role="alert">
          {error.message}
        </p>
      ) : null}
      <button
        className="btn"
        type="submit"
        disabled={approve.isPending || merge.isPending}
        style={{ alignSelf: 'flex-start' }}
      >
        {mode === 'approve' ? 'Approve category' : 'Merge'}
      </button>
    </form>
  );
}
