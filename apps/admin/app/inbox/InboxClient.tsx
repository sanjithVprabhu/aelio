'use client';

import { useState } from 'react';
import { tapi } from '../lib/client';
import { PriorityBadge, StatusBadge, fmtDate } from '../components/ui';
import { Spinner, useAsync, OfflineBlock, LoadingBlock, errMessage } from '../components/client-ui';

type InboxItem = {
  id: string;
  conversationId: string;
  displayName: string;
  reason: string;
  priority: string;
  status: string;
  createdAt: string;
};

export default function InboxClient() {
  const { data, error, loading, reload } = useAsync<InboxItem[]>(() => tapi.get<InboxItem[]>('/inbox'));
  const [active, setActive] = useState<string | null>(null);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <OfflineBlock error={error ?? 'No data'} />;
  if (data.length === 0)
    return (
      <div className="empty">
        <h3>Inbox is clear</h3>
        <p>No escalations are waiting for a human right now.</p>
      </div>
    );

  return (
    <div className="cards-grid" style={{ gridTemplateColumns: '1fr' }}>
      {data.map((item) => (
        <InboxCard
          key={item.id}
          item={item}
          open={active === item.id}
          onToggle={() => setActive((a) => (a === item.id ? null : item.id))}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

function InboxCard({
  item,
  open,
  onToggle,
  onChanged,
}: {
  item: InboxItem;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reply, setReply] = useState('');

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      onChanged();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const resolved = item.status === 'resolved';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{item.displayName}</h4>
            <PriorityBadge priority={item.priority} />
            <StatusBadge status={item.status} />
          </div>
          <p style={{ margin: '4px 0 6px', color: 'var(--ink-70)', fontSize: 13 }}>{item.reason}</p>
          <div className="mono muted" style={{ fontSize: 11.5 }}>
            conv {item.conversationId} · {fmtDate(item.createdAt)}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onToggle}>
          {open ? 'Close' : 'Open'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hairline-soft)' }}>
          <div className="btn-row" style={{ marginBottom: 14 }}>
            <button
              className="btn btn-sm"
              disabled={!!busy || resolved}
              onClick={() => act('claim', () => tapi.post(`/inbox/${item.id}/claim`, { agentName: 'Admin' }))}
            >
              {busy === 'claim' ? <Spinner /> : 'Claim'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!!busy || resolved}
              onClick={() => act('urgent', () => tapi.post(`/inbox/${item.id}/urgent`))}
            >
              {busy === 'urgent' ? <Spinner /> : 'Mark urgent'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={!!busy || resolved}
              onClick={() => act('resolve', () => tapi.post(`/inbox/${item.id}/resolve`))}
            >
              {busy === 'resolve' ? <Spinner /> : 'Resolve'}
            </button>
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label>Reply to customer</label>
            <textarea
              className="textarea"
              style={{ minHeight: 70 }}
              value={reply}
              disabled={resolved}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type a response to send into the conversation…"
            />
          </div>
          <button
            className="btn btn-sm"
            disabled={!!busy || resolved || !reply.trim()}
            onClick={() =>
              act('reply', async () => {
                await tapi.post(`/inbox/${item.id}/reply`, { text: reply });
                setReply('');
              })
            }
          >
            {busy === 'reply' ? <Spinner /> : 'Send reply'}
          </button>
        </div>
      )}
    </div>
  );
}
