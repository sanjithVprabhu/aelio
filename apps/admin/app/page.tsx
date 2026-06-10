import { apiGet, tenantPath, Overview, Analytics } from './lib/api';
import { OfflineState, pct } from './components/ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const overviewRes = await apiGet<Overview>(tenantPath('/overview'));
  const analyticsRes = await apiGet<Analytics>(tenantPath('/analytics'));

  return (
    <>
      <div className="page-head">
        <h2>Dashboard</h2>
        <p>Live operating picture for tenant acme.</p>
      </div>

      {!overviewRes.ok ? (
        <OfflineState error={overviewRes.error} />
      ) : (
        <Dashboard overview={overviewRes.data} analytics={analyticsRes.ok ? analyticsRes.data : null} />
      )}
    </>
  );
}

function Dashboard({ overview, analytics }: { overview: Overview; analytics: Analytics | null }) {
  const states = overview.states ?? [];
  const maxState = Math.max(1, ...states.map((s) => s.count));
  const topActions = analytics?.topActions ?? [];

  return (
    <>
      <div className="metrics">
        <div className="metric">
          <div className="label">Conversations</div>
          <div className="value">{overview.conversations ?? 0}</div>
        </div>
        <div className="metric">
          <div className="label">Escalations</div>
          <div className="value">{overview.escalations ?? 0}</div>
          {analytics && <div className="sub">{pct(analytics.escalationRate)} escalation rate</div>}
        </div>
        <div className="metric">
          <div className="label">Exposed actions</div>
          <div className="value">{overview.actionsExposed ?? 0}</div>
        </div>
        <div className="metric">
          <div className="label">Resolution rate</div>
          <div className="value">{pct(overview.resolutionRate)}</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <p className="card-title">State distribution</p>
          {states.length === 0 ? (
            <p className="muted">No state data.</p>
          ) : (
            states.map((s) => (
              <div className="bar-row" key={s.state}>
                <span className="bar-label">{s.state}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${(s.count / maxState) * 100}%` }} />
                </span>
                <span className="bar-count">{s.count}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <p className="card-title">Top actions</p>
          {topActions.length === 0 ? (
            <p className="muted">No action invocations yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th className="num">Calls</th>
                  <th className="num">Success</th>
                </tr>
              </thead>
              <tbody>
                {topActions.map((a) => (
                  <tr key={a.key}>
                    <td className="mono">{a.key}</td>
                    <td className="num">{a.count}</td>
                    <td className="num">{pct(a.successRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
