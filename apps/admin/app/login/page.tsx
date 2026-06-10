'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { login, setToken } from '../lib/client';
import { Spinner, Toast, errMessage } from '../components/client-ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@acme.com');
  const [password, setPassword] = useState('password');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      setToken(res.token);
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="wordmark">Aelio.</div>
        <h2>Sign in</h2>
        <p className="lede">Access the admin console for tenant acme.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && (
            <div style={{ marginBottom: 14 }}>
              <Toast kind="err">{error}</Toast>
            </div>
          )}
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 14, fontSize: 11.5 }}>
          Demo: <span className="mono">admin@acme.com</span> / <span className="mono">password</span>
        </p>
        <div className="auth-foot">
          No account? <Link className="link" href="/signup">Create one</Link>
          {' · '}
          <Link className="link" href="/">Continue without signing in</Link>
        </div>
      </div>
    </div>
  );
}
