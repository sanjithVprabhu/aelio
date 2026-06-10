import { apiGet, tenantPath, Settings } from '../lib/api';
import { OfflineState } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const res = await apiGet<Settings>(tenantPath('/settings'));

  return (
    <>
      <div className="page-head">
        <h2>Settings</h2>
        <p>Model, compliance, and plan configuration for tenant acme.</p>
      </div>

      {!res.ok ? <OfflineState error={res.error} /> : <SettingsView s={res.data} />}
    </>
  );
}

function SettingsView({ s }: { s: Settings }) {
  return (
    <div className="cards-grid">
      <div className="card">
        <p className="card-title">LLM</p>
        <dl className="kv">
          <dt>Mode</dt>
          <dd>{s.llm?.mode || '—'}</dd>
          <dt>Provider</dt>
          <dd>{s.llm?.provider || '—'}</dd>
          <dt>Model</dt>
          <dd className="mono">{s.llm?.model || '—'}</dd>
        </dl>
      </div>

      <div className="card">
        <p className="card-title">Compliance</p>
        <dl className="kv">
          <dt>Region</dt>
          <dd>{s.compliance?.region || '—'}</dd>
          <dt>Retention</dt>
          <dd>{s.compliance?.retention || '—'}</dd>
          <dt>PII redaction</dt>
          <dd>
            {s.compliance?.piiRedaction ? (
              <span className="badge badge-soft status-ok">enabled</span>
            ) : (
              <span className="badge badge-soft status-bad">disabled</span>
            )}
          </dd>
        </dl>
      </div>

      <div className="card">
        <p className="card-title">Plan</p>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
          {s.plan || '—'}
        </div>
      </div>
    </div>
  );
}
