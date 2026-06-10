import { apiGet, tenantPath, Playbook } from '../lib/api';
import { OfflineState, StatusBadge, TierBadge, Toggle } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function PlaybooksPage() {
  const res = await apiGet<Playbook>(tenantPath('/playbook'));

  return (
    <>
      <div className="page-head">
        <h2>Playbooks</h2>
        <p>The conversation policy: lifecycle states, triggers, and the fallback ladder.</p>
      </div>

      {!res.ok ? <OfflineState error={res.error} /> : <PlaybookView pb={res.data} />}
    </>
  );
}

function PlaybookView({ pb }: { pb: Playbook }) {
  const states = pb.states ?? [];
  const triggers = pb.triggers ?? [];
  const ladder = (pb.fallbackLadder ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 6, alignItems: 'center' }}>
        <span className="chip">v{pb.version}</span>
        <StatusBadge status={pb.status} />
        <span className="muted" style={{ fontSize: 12.5 }}>
          default state · <span className="mono">{pb.defaultState}</span>
        </span>
      </div>

      <div className="section">
        <h3>Lifecycle states</h3>
        <div className="cards-grid">
          {states.map((s) => (
            <div className="card state-card" key={s.key}>
              <h4>{s.label}</h4>
              <div className="key">{s.key}</div>
              <p>{s.description}</p>
              <dl className="kv">
                <dt>Opening</dt>
                <dd>{s.openingBehavior || '—'}</dd>
                <dt>Confirm tier</dt>
                <dd>
                  {s.requireConfirmationForTier != null ? (
                    <TierBadge tier={s.requireConfirmationForTier} />
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Allowed actions</dt>
                <dd>
                  <span className="chips">
                    {(s.allowedActions ?? []).length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      (s.allowedActions ?? []).map((a) => (
                        <span className="badge badge-outline mono" key={a}>
                          {a}
                        </span>
                      ))
                    )}
                  </span>
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3>Triggers</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Trigger</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {triggers.length === 0 ? (
                <tr>
                  <td colSpan={2} className="muted">
                    No triggers defined.
                  </td>
                </tr>
              ) : (
                triggers.map((t) => (
                  <tr key={t.id}>
                    <td>{t.label}</td>
                    <td>
                      <Toggle on={t.enabled} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section">
        <h3>Fallback ladder</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num" style={{ width: 60 }}>
                  #
                </th>
                <th>Strategy</th>
                <th>Config</th>
              </tr>
            </thead>
            <tbody>
              {ladder.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No fallback steps.
                  </td>
                </tr>
              ) : (
                ladder.map((f) => (
                  <tr key={f.order}>
                    <td className="num">{f.order}</td>
                    <td>
                      <span className="badge badge-soft">{f.strategy}</span>
                    </td>
                    <td className="mono muted">
                      {f.config ? JSON.stringify(f.config) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
