import { apiGet, tenantPath, Analytics } from '../lib/api';
import { OfflineState } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function KnowledgePage() {
  const res = await apiGet<Analytics>(tenantPath('/analytics'));

  return (
    <>
      <div className="page-head">
        <h2>Knowledge</h2>
        <p>Grounding sources the assistant draws on, and how conversations distribute across them.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : (
        <>
          <div className="empty" style={{ marginBottom: 24 }}>
            <h3>Knowledge collections</h3>
            <p>
              No knowledge collections are configured yet. Ingest documents or connect a source to ground
              the assistant&apos;s answers.
            </p>
          </div>

          <div className="card">
            <p className="card-title">Conversation state distribution</p>
            {(res.data.stateDistribution ?? []).length === 0 ? (
              <p className="muted">No data.</p>
            ) : (
              (() => {
                const dist = res.data.stateDistribution;
                const max = Math.max(1, ...dist.map((d) => d.count));
                return dist.map((d) => (
                  <div className="bar-row" key={d.state}>
                    <span className="bar-label">{d.state}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(d.count / max) * 100}%` }} />
                    </span>
                    <span className="bar-count">{d.count}</span>
                  </div>
                ));
              })()
            )}
          </div>
        </>
      )}
    </>
  );
}
