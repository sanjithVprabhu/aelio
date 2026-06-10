'use client';

import React, { useEffect, useState } from 'react';
import { ApiError } from '../lib/client';

export function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 0 ? 'API offline — could not reach the Aelio API.' : err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function Spinner() {
  return <span className="spinner" aria-label="loading" />;
}

export function Toast({ kind, children }: { kind: 'ok' | 'err'; children: React.ReactNode }) {
  return <div className={`toast ${kind === 'ok' ? 'toast-ok' : 'toast-err'}`}>{children}</div>;
}

/** A real (clickable) toggle switch matching the .toggle visual. */
export function ToggleButton({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toggle-btn"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className={`toggle ${on ? 'on' : ''}`} />
    </button>
  );
}

export function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>{title}</h3>
          <button className="x-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
        {footer && <div style={{ marginTop: 22 }}>{footer}</div>}
      </div>
    </Overlay>
  );
}

export function Modal({
  title,
  sub,
  onClose,
  children,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </Overlay>
  );
}

/** Generic data-loading wrapper for client pages. */
export function useAsync<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(errMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload, setData };
}

export function OfflineBlock({ error }: { error: string }) {
  return (
    <div className="empty">
      <h3>API offline</h3>
      <p>Could not reach the Aelio API. Start it with <code>pnpm --filter @aelio/api dev</code>.</p>
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        {error}
      </p>
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="empty">
      <p className="muted">Loading…</p>
    </div>
  );
}
