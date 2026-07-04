'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, ApiError } from '../lib/api';

/** Guard + fetch hook. Redirects to /login if no token, then loads `path`. */
export function useApi<T>(path: string, deps: any[] = []): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined' && !getToken()) {
      router.replace('/login');
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((d) => {
        if (live) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e instanceof ApiError ? e.message : 'Failed to load');
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);

  return { data, loading, error, reload: () => setN((x) => x + 1) };
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '28px 32px', maxWidth: 1100 }}>{children}</div>;
}

export function PageHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{title}</h2>
      {sub && <p style={{ margin: '6px 0 0', color: 'var(--ink-45)', fontSize: 13.5 }}>{sub}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ padding: 60, display: 'grid', placeItems: 'center' }}>
      <span className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px dashed rgba(196,56,56,.3)', borderRadius: 12, padding: '40px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--red)' }}>Couldn't load</div>
      <div style={{ color: 'var(--ink-45)', fontSize: 13.5, marginBottom: onRetry ? 16 : 0 }}>{message}</div>
      {onRetry && (
        <button onClick={onRetry} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px dashed var(--ink-10)', borderRadius: 12, padding: '44px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {hint && <div style={{ color: 'var(--ink-45)', fontSize: 13.5 }}>{hint}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
    </div>
  );
}

export const th: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--ink-45)',
  padding: '12px 18px',
  borderBottom: '1px solid var(--ink-10)',
  background: 'rgba(10,10,10,.015)',
};

export const td: React.CSSProperties = {
  padding: '13px 18px',
  borderBottom: '1px solid var(--ink-05)',
  fontSize: 13.5,
  verticalAlign: 'middle',
};
