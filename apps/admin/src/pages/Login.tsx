import { type FormEvent, useState } from 'react';
import { api, session } from '../api';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.login({
        email: String(form.get('email')),
        password: String(form.get('password')),
        code: String(form.get('code')).replace(/\s/g, ''),
      });
      session.set(token);
      onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed.');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={(event) => void submit(event)}>
        <div className="brand">
          <span className="wordmark">sibimate</span>
          <span className="muted small">admin</span>
        </div>
        <h1 style={{ fontSize: 24, lineHeight: '30px' }}>Sign in</h1>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>Authenticator code</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            placeholder="6 digits"
            required
          />
        </label>
        {error ? (
          <p className="notice alert" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
