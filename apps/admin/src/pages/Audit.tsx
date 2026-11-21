import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const ACTIONS: Record<string, string> = {
  'task.assign': 'Assigned a helper',
  'task.widen': 'Widened a search',
  'user.block': 'Blocked an account',
  'user.unblock': 'Unblocked an account',
  'helper.create': 'Added a helper',
  'helper.approve': 'Approved a helper',
  'helper.reject': 'Turned down an application',
  'document.view': 'Opened a document',
  'dispute.resolve': 'Decided a dispute',
  'settings.update': 'Changed settings',
  'commission.change': 'Changed a commission rate',
  'dues.settle': 'Recorded cash dues paid',
  'category.approve': 'Approved a category',
  'category.merge': 'Merged a category',
};

/** Every admin action and document view, newest first. Owners only. */
export function Audit() {
  const audit = useQuery({ queryKey: ['audit'], queryFn: api.audit, refetchInterval: 30_000 });
  const items = audit.data?.items ?? [];
  return (
    <>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Audit log</h1>
        <span className="muted" style={{ fontSize: 14 }}>
          Every change an admin makes and every document opened. Entries cannot be edited or removed.
        </span>
      </div>
      {audit.isError ? (
        <p className="notice alert" role="alert">
          {audit.error.message}
        </p>
      ) : null}
      <section className="card table" aria-label="Audit log">
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Admin</th>
              <th scope="col">Action</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(item.at).toLocaleString('en-IN')}</td>
                <td>{item.admin}</td>
                <td className="strong">{ACTIONS[item.action] ?? item.action}</td>
                <td className="small muted" style={{ textAlign: 'left', overflowWrap: 'anywhere' }}>
                  {item.meta ? JSON.stringify(item.meta) : ''}
                </td>
              </tr>
            ))}
            {audit.isSuccess && items.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: 'left', padding: '20px 0' }}>
                  Nothing recorded yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
