import { apiGet, tenantPath, Channel } from '../lib/api';
import { OfflineState, StatusBadge, Toggle, MaskedConfig } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const res = await apiGet<Channel[]>(tenantPath('/channels'));

  return (
    <>
      <div className="page-head">
        <h2>Channels</h2>
        <p>Inbound and outbound surfaces the assistant connects to.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h3>No channels connected</h3>
          <p>Connect a channel to start receiving conversations.</p>
        </div>
      ) : (
        <div className="cards-grid">
          {res.data.map((c) => (
            <div className="card" key={c.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 16,
                }}
              >
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>
                  {c.type}
                </h4>
                <StatusBadge status={c.status} />
              </div>

              <div style={{ display: 'flex', gap: 18, marginBottom: 16 }}>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                  <Toggle on={c.inboundEnabled} /> Inbound
                </span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                  <Toggle on={c.outboundEnabled} /> Outbound
                </span>
              </div>

              <p className="card-title" style={{ marginBottom: 10 }}>
                Configuration
              </p>
              <MaskedConfig config={c.config} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
