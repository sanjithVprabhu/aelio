import { apiGet, tenantPath, ActionPolicy } from '../lib/api';
import { OfflineState, TierBadge, MethodBadge, Toggle } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function ActionsPage() {
  const res = await apiGet<ActionPolicy[]>(tenantPath('/actions'));

  return (
    <>
      <div className="page-head">
        <h2>Actions</h2>
        <p>The capability surface — which API actions the assistant may take, and under what policy.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h3>No actions configured</h3>
          <p>Ingest an API spec to populate actions.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Endpoint</th>
                <th>Tier</th>
                <th>Step-up</th>
                <th className="num">Rate / hr</th>
                <th>Exposed</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{a.label}</div>
                    <div className="mono muted" style={{ fontSize: 11.5 }}>
                      {a.key}
                    </div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                      <MethodBadge method={a.method} />
                      <span className="mono">{a.path}</span>
                    </span>
                  </td>
                  <td>
                    <TierBadge tier={a.tier} />
                  </td>
                  <td>
                    {a.stepUpRequired ? (
                      <span className="badge badge-soft status-warn">required</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{a.rateLimitPerUserPerHour ?? '∞'}</td>
                  <td>
                    <Toggle on={a.exposed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
