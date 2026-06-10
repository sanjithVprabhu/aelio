import Link from 'next/link';
import { apiGet, tenantPath, ConversationDetail } from '../../lib/api';
import { OfflineState, StatusBadge, TierBadge, fmtDate } from '../../components/ui';

export const dynamic = 'force-dynamic';

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiGet<ConversationDetail>(tenantPath(`/conversations/${id}`));

  return (
    <>
      <div className="page-head">
        <p style={{ marginBottom: 6 }}>
          <Link className="link" href="/conversations">
            ← Conversations
          </Link>
        </p>
        <h2>Conversation</h2>
        <p className="mono">{id}</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : (
        <Thread detail={res.data} />
      )}
    </>
  );
}

function Thread({ detail }: { detail: ConversationDetail }) {
  const turns = detail.turns ?? [];
  const invocations = detail.invocations ?? [];

  return (
    <>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <span className="chip">state · {detail.state}</span>
        <StatusBadge status={detail.status} />
      </div>

      <div className="thread-layout">
        <div className="card">
          <p className="card-title">Transcript</p>
          {turns.length === 0 ? (
            <p className="muted">No turns recorded.</p>
          ) : (
            <div className="turns">
              {turns.map((t, i) => {
                const role = (t.role || '').toLowerCase();
                const isUser = role === 'user' || role === 'end_user' || role === 'human';
                return (
                  <div className={`turn ${isUser ? 'user' : 'assistant'}`} key={i}>
                    <div className="bubble">{t.text}</div>
                    <div className="meta-line">
                      {t.role} · {fmtDate(t.at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <p className="card-title">Action invocations</p>
          {invocations.length === 0 ? (
            <p className="muted">No actions invoked.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {invocations.map((inv, i) => {
                const key = inv.actionKey || inv.key || `invocation-${i}`;
                return (
                  <div
                    key={i}
                    style={{
                      borderBottom: i < invocations.length - 1 ? '1px solid var(--hairline-soft)' : 'none',
                      paddingBottom: 12,
                    }}
                  >
                    <div className="mono" style={{ fontSize: 12.5, marginBottom: 6 }}>
                      {key}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      {inv.tier != null && <TierBadge tier={inv.tier} />}
                      {inv.status && <StatusBadge status={String(inv.status)} />}
                      {inv.at && <span className="muted" style={{ fontSize: 11 }}>{fmtDate(String(inv.at))}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
