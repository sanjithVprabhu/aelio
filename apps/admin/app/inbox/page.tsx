'use client';

import React, { useState } from 'react';
import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty } from '../components/data';
import { api } from '../lib/api';

export default function InboxPage() {
  const { data, loading, error, reload } = useApi<any[]>('/inbox');
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, verb: 'claim' | 'reply' | 'resolve' | 'urgent') {
    setBusy(id + verb);
    try {
      const body = verb === 'reply' ? { text: reply[id] || '' } : {};
      await api(`/inbox/${id}/${verb}`, { method: 'POST', body });
      if (verb === 'reply') setReply((r) => ({ ...r, [id]: '' }));
      reload();
    } catch (e) {
      // surface inline below via reload of error state is enough; keep simple
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppShell title="Inbox" breadcrumb="Build">
      <PageBody>
        <PageHead title="Inbox" sub="Conversations escalated to a human." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="Inbox zero" hint="When the agent escalates, those threads land here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {data.map((t) => (
              <div key={t.id} style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.subject || t.userId || t.externalUserId || 'Thread ' + String(t.id).slice(0, 6)}</span>
                  {t.priority === 'urgent' && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--red-bg)', color: 'var(--red)' }}>URGENT</span>}
                  <span style={{ fontSize: 11.5, color: 'var(--ink-45)' }}>{t.status || 'open'}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 11.5, color: 'var(--ink-45)' }}>{t.updatedAt ? new Date(t.updatedAt).toLocaleString() : ''}</span>
                </div>
                {t.lastMessage && <div style={{ fontSize: 13, color: 'var(--ink-70)', marginBottom: 12, lineHeight: 1.5 }}>{t.lastMessage}</div>}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input
                    value={reply[t.id] || ''}
                    onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))}
                    placeholder="Reply…"
                    style={{ flex: 1, border: '1px solid var(--ink-10)', borderRadius: 8, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                  />
                  <button onClick={() => act(t.id, 'reply')} disabled={!reply[t.id]?.trim() || busy === t.id + 'reply'} style={{ ...darkBtn, opacity: !reply[t.id]?.trim() ? 0.5 : 1 }}>
                    Send
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => act(t.id, 'claim')} style={ghostBtn}>
                    Claim
                  </button>
                  <button onClick={() => act(t.id, 'urgent')} style={ghostBtn}>
                    Mark urgent
                  </button>
                  <button onClick={() => act(t.id, 'resolve')} style={{ ...ghostBtn, color: 'var(--green)', borderColor: 'rgba(60,155,106,.3)' }}>
                    Resolve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}

const darkBtn: React.CSSProperties = { padding: '8px 14px', fontSize: 12.5, fontWeight: 600, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: React.CSSProperties = { padding: '6px 13px', fontSize: 12.5, fontWeight: 600, background: 'var(--white)', color: 'var(--ink-70)', border: '1px solid var(--ink-10)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
