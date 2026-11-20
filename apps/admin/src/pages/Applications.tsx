import {
  DOCUMENTS_FOR_LEVEL,
  type HelperApplicationDetail,
  VERIFICATION_LEVELS,
  type VerificationLevel,
} from '@sibimate/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../api';

const DOCUMENT_NAMES = {
  identity: 'Government photo ID',
  photo: 'Photo of face',
  qualification: 'Proof of trade',
} as const;
const LEVEL_NAMES: Record<VerificationLevel, string> = {
  basic: 'Basic: tasks in public places',
  verified: 'Verified: can enter homes',
  specialised: 'Specialised: gets the skilled tag',
};

/** Applications waiting for a verifier, oldest first. */
export function Applications() {
  const applications = useQuery({ queryKey: ['applications'], queryFn: api.applications, refetchInterval: 30_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = applications.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;

  if (applications.isSuccess && items.length === 0) {
    return null;
  }
  return (
    <>
      <h2>Applications to review · {items.length}</h2>
      {applications.isError ? (
        <p className="notice alert" role="alert">
          {applications.error.message}
        </p>
      ) : null}
      <div className="split">
        <section className="card table" aria-label="Applications">
          <table>
            <thead>
              <tr>
                <th scope="col">Applicant</th>
                <th scope="col">Work</th>
                <th scope="col">Documents</th>
                <th scope="col">
                  <span className="sr-only">Review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={item.id === selectedId ? 'selected' : undefined}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="strong">{item.name ?? 'No name'}</span>
                      <span className="small muted">{item.phone}</span>
                    </div>
                  </td>
                  <td>
                    {item.claimsSkilled
                      ? `Skilled${item.skills.length ? `: ${item.skills.join(', ')}` : ''}`
                      : 'Everyday help'}
                  </td>
                  <td>
                    {item.documents.length === 0 ? (
                      <span className="muted">None yet</span>
                    ) : (
                      item.documents.map((document) => DOCUMENT_NAMES[document.kind]).join(', ')
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary"
                      aria-label={`Review ${item.name ?? item.phone}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {selected ? <ReviewPanel key={selected.id} application={selected} /> : null}
      </div>
    </>
  );
}

function ReviewPanel({ application }: { application: HelperApplicationDetail }) {
  const queryClient = useQueryClient();
  const uploaded = application.documents.map((document) => document.kind);
  // The highest level the uploaded documents allow is offered first.
  const allowed = VERIFICATION_LEVELS.filter((level) =>
    DOCUMENTS_FOR_LEVEL[level].every((kind) => uploaded.includes(kind)),
  );
  const [level, setLevel] = useState<VerificationLevel | ''>(allowed.at(-1) ?? '');
  const [rejecting, setRejecting] = useState(false);
  const done = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['applications'] }),
      queryClient.invalidateQueries({ queryKey: ['helpers'] }),
    ]);
  const approve = useMutation({
    mutationFn: () => api.approveApplication(application.id, level as VerificationLevel),
    onSuccess: done,
  });
  const reject = useMutation({
    mutationFn: (reason: string) => api.rejectApplication(application.id, reason),
    onSuccess: done,
  });

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reject.mutate(String(new FormData(event.currentTarget).get('reason')));
  }

  return (
    <section className="card stack" style={{ gap: 16 }} aria-label="Application under review">
      <h2>{application.name ?? application.phone}</h2>
      <dl className="facts">
        <div>
          <dt>Mobile</dt>
          <dd>{application.phone}</dd>
        </div>
        <div>
          <dt>Says they do</dt>
          <dd>
            {application.claimsSkilled
              ? `Skilled work: ${application.skills.join(', ') || 'no trades listed'}`
              : 'Everyday help'}
          </dd>
        </div>
        <div className="wide">
          <dt>Emergency contact</dt>
          <dd>{application.emergencyContact ?? 'Not given'}</dd>
        </div>
      </dl>

      {application.documents.length === 0 ? (
        <p className="notice neutral">No documents uploaded yet. The applicant can still add them.</p>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <p className="small muted">Each time you open a document it is recorded in the audit log.</p>
          {application.documents.map((document) => (
            <DocumentImage key={document.id} id={document.id} name={DOCUMENT_NAMES[document.kind]} />
          ))}
        </div>
      )}

      {rejecting ? (
        <form className="stack" style={{ gap: 12 }} onSubmit={submitRejection}>
          <label className="field">
            <span>Reason, shown to the applicant</span>
            <input
              name="reason"
              required
              minLength={5}
              maxLength={300}
              placeholder="The ID photo is too blurred to read."
            />
          </label>
          {reject.isError ? (
            <p className="notice alert" role="alert">
              {reject.error.message}
            </p>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary" type="button" onClick={() => setRejecting(false)}>
              Back
            </button>
            <button className="btn danger" type="submit" disabled={reject.isPending}>
              {reject.isPending ? 'Sending…' : 'Turn down application'}
            </button>
          </div>
        </form>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <label className="field">
            <span>Approve at level</span>
            <select value={level} onChange={(event) => setLevel(event.target.value as VerificationLevel)}>
              {allowed.length === 0 ? <option value="">Needs a photo ID first</option> : null}
              {allowed.map((option) => (
                <option key={option} value={option}>
                  {LEVEL_NAMES[option]}
                </option>
              ))}
            </select>
          </label>
          {approve.isError ? (
            <p className="notice alert" role="alert">
              {approve.error.message}
            </p>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn"
              type="button"
              disabled={!level || approve.isPending}
              onClick={() => approve.mutate()}
            >
              {approve.isPending ? 'Approving…' : 'Approve helper'}
            </button>
            <button className="btn secondary" type="button" onClick={() => setRejecting(true)}>
              Turn down…
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Shows a document only when asked, because every view is recorded against the admin. */
function DocumentImage({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => api.documentImage(id),
    onSuccess: (blob) => setUrl(URL.createObjectURL(blob)),
  });
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <span className="strong">{name}</span>
        {url ? null : (
          <button className="btn secondary" type="button" disabled={open.isPending} onClick={() => open.mutate()}>
            {open.isPending ? 'Opening…' : `Open ${name.toLowerCase()}`}
          </button>
        )}
      </div>
      {open.isError ? (
        <p className="notice alert" role="alert">
          {open.error.message}
        </p>
      ) : null}
      {url ? (
        <img
          src={url}
          alt={name}
          style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 12, border: '1px solid var(--border)' }}
        />
      ) : null}
    </div>
  );
}
