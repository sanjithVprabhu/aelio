import React from 'react';

export function OfflineState({ error }: { error: string }) {
  return (
    <div className="empty">
      <h3>API offline</h3>
      <p>
        Could not reach the Aelio API. Start it with <code>pnpm --filter @aelio/api dev</code> (or{' '}
        <code>apps/api</code>).
      </p>
      <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        {error}
      </p>
    </div>
  );
}

function normTier(tier: string | number): string {
  const s = String(tier).toUpperCase().replace(/^TIER[\s_-]?/, '').replace(/^T/, '');
  return s;
}

export function TierBadge({ tier }: { tier: string | number }) {
  const n = normTier(tier);
  const idx = ['0', '1', '2', '3'].includes(n) ? n : '0';
  return <span className={`badge tier tier-${idx}`}>T{idx}</span>;
}

const METHOD_NOTHING = '';

export function MethodBadge({ method }: { method: string }) {
  const m = (method || METHOD_NOTHING).toUpperCase();
  const color =
    m === 'GET'
      ? 'var(--tier-1)'
      : m === 'POST'
        ? 'var(--tier-0)'
        : m === 'DELETE'
          ? 'var(--tier-3)'
          : 'var(--tier-2)';
  return (
    <span className="method" style={{ color }}>
      {m}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const good = ['active', 'connected', 'resolved', 'verified', 'live', 'ok', 'enabled', 'open'];
  const bad = ['error', 'failed', 'disconnected', 'unverified', 'blocked', 'suspended'];
  const warn = ['pending', 'escalated', 'paused', 'review', 'waiting', 'degraded'];
  let cls = 'badge-soft';
  let dot = 'var(--ink-45)';
  if (good.includes(s)) dot = 'var(--tier-0)';
  else if (bad.includes(s)) dot = 'var(--tier-3)';
  else if (warn.includes(s)) dot = 'var(--tier-2)';
  return (
    <span className={`badge ${cls}`}>
      <span className="dot" style={{ background: dot }} />
      {status}
    </span>
  );
}

export function Toggle({ on }: { on: boolean }) {
  return <span className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} />;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const p = (priority || '').toLowerCase();
  const color =
    p === 'high' || p === 'urgent'
      ? 'var(--tier-3)'
      : p === 'medium'
        ? 'var(--tier-2)'
        : 'var(--ink-45)';
  return (
    <span className="badge badge-outline" style={{ color }}>
      {priority}
    </span>
  );
}

export function maskValue(v: unknown): string {
  if (v == null) return '—';
  const s = String(v);
  if (s.length <= 6) return '••••';
  return `${s.slice(0, 3)}••••${s.slice(-3)}`;
}

const SECRET_KEYS = /token|secret|key|password|signing|webhook|apikey|api_key|auth/i;

export function MaskedConfig({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config || {});
  if (entries.length === 0) return <span className="muted">No configuration</span>;
  return (
    <dl className="kv">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd className="mono">
            {SECRET_KEYS.test(k) ? maskValue(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function pct(n: number): string {
  if (n == null || isNaN(n)) return '—';
  // accept either 0..1 or 0..100
  const v = n <= 1 ? n * 100 : n;
  return `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;
}
