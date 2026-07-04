'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { login, signup, setToken, ApiError } from '../lib/api';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853" />
    <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335" />
  </svg>
);

export default function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const isSignup = mode === 'signup';
  const [email, setEmail] = useState(isSignup ? '' : 'admin@acme.com');
  const [password, setPassword] = useState(isSignup ? '' : 'password');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = isSignup
        ? await signup(email, password, name || email.split('@')[0])
        : await login(email, password);
      setToken(res.token);
      router.push(isSignup ? '/setup' : '/');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 2rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1.24rem', letterSpacing: '-0.01em' }}>Aelio.</div>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem 1.5rem 3rem' }}>
        <div style={{ width: '100%', maxWidth: 420, animation: 'fadeUp 0.45s var(--ease) forwards' }}>
          <h1
            style={{
              fontSize: '1.55rem',
              fontWeight: 700,
              letterSpacing: '-0.025em',
              textAlign: 'center',
              marginBottom: '1.8rem',
              lineHeight: 1.15,
            }}
          >
            {isSignup ? 'Create an account' : 'Welcome back'}
          </h1>

          <button type="button" onClick={() => router.push(isSignup ? '/setup' : '/')} style={googleBtn}>
            <GoogleIcon />
            {isSignup ? 'Sign up with Google' : 'Sign in with Google'}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', margin: '1.2rem 0' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--ink-22)' }} />
            <em style={{ fontStyle: 'normal', fontSize: '0.82rem', color: 'var(--ink-45)' }}>or</em>
            <span style={{ flex: 1, height: 1, background: 'var(--ink-22)' }} />
          </div>

          <form onSubmit={submit}>
            {isSignup && (
              <div style={fieldWrap}>
                <label style={lbl}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="Your name" />
              </div>
            )}
            <div style={fieldWrap}>
              <label style={lbl}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} required />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...inp, paddingRight: '2.8rem' }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                  style={{
                    position: 'absolute',
                    right: '0.8rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--ink-45)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </div>
            </div>

            {err && (
              <div style={{ color: 'var(--red)', fontSize: '0.88rem', margin: '0.2rem 0 0.6rem', fontWeight: 500 }}>{err}</div>
            )}

            <button type="submit" disabled={busy} style={{ ...authBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
              <span style={{ fontSize: '1.1em' }}>→</span>
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1.1rem', fontSize: '0.93rem', color: 'var(--ink-70)' }}>
            {isSignup ? (
              <>
                Already have an account?{' '}
                <Link href="/login" style={authLink}>
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New to Aelio?{' '}
                <Link href="/signup" style={authLink}>
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </main>

      <footer
        style={{
          padding: '1.5rem 2rem',
          textAlign: 'center',
          fontSize: '0.82rem',
          color: 'var(--ink-45)',
          borderTop: '1px solid var(--ink-10)',
        }}
      >
        By continuing, you agree to our Terms of Service and Privacy Policy.
      </footer>
    </div>
  );
}

const googleBtn: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.75rem',
  fontFamily: 'inherit',
  fontSize: '0.98rem',
  fontWeight: 500,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink-22)',
  borderRadius: 8,
  padding: '0.82em 1em',
  cursor: 'pointer',
};
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.9rem' };
const lbl: React.CSSProperties = { fontSize: '0.9rem', fontWeight: 500, color: 'var(--ink-70)' };
const inp: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '1rem',
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--ink-22)',
  borderRadius: 8,
  padding: '0.76em 1em',
  width: '100%',
  outline: 'none',
};
const authBtn: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5em',
  fontFamily: 'inherit',
  fontSize: '1rem',
  fontWeight: 600,
  background: 'var(--black)',
  color: 'var(--white)',
  border: 'none',
  borderRadius: 8,
  padding: '0.88em 1em',
  cursor: 'pointer',
  marginTop: '0.3rem',
  lineHeight: 1,
};
const authLink: React.CSSProperties = { color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 };
