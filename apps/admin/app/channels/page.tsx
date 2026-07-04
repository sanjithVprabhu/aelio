'use client';

import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty } from '../components/data';

const ICONS: Record<string, string> = { web_chat: '⬡', whatsapp: '💬', slack: '⚡', embedded: '⬡' };

export default function ChannelsPage() {
  const { data, loading, error, reload } = useApi<any[]>('/channels');
  return (
    <AppShell title="Channels" breadcrumb="Connect">
      <PageBody>
        <PageHead title="Channels" sub="Where your agent meets your users." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No channels connected" />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {data.map((c) => (
              <div key={c.id} style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 9, background: 'var(--cream)', display: 'grid', placeItems: 'center', fontSize: 18 }}>{ICONS[c.type] || '⬡'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, textTransform: 'capitalize' }}>{(c.type || 'channel').replace(/_/g, ' ')}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{c.config?.widgetName || c.id?.slice(0, 8)}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, background: c.status === 'active' ? 'var(--green-bg)' : 'var(--ink-05)', color: c.status === 'active' ? 'var(--green)' : 'var(--ink-70)' }}>{c.status}</span>
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 12.5, margin: 0 }}>
                  <dt style={{ color: 'var(--ink-45)' }}>Inbound</dt>
                  <dd style={{ margin: 0 }}>{c.inboundEnabled ? 'Enabled' : 'Disabled'}</dd>
                  <dt style={{ color: 'var(--ink-45)' }}>Outbound</dt>
                  <dd style={{ margin: 0 }}>{c.outboundEnabled ? 'Enabled' : 'Disabled'}</dd>
                  {c.config?.accentColor && (
                    <>
                      <dt style={{ color: 'var(--ink-45)' }}>Accent</dt>
                      <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: c.config.accentColor, border: '1px solid var(--ink-10)' }} />
                        {c.config.accentColor}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}
