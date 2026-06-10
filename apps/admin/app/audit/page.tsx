import { apiGet, tenantPath, AuditEvent } from '../lib/api';
import { OfflineState, fmtDate } from '../components/ui';

export const dynamic = 'force-dynamic';

function summarizePayload(payload: unknown): string {
  if (payload == null) return '—';
  if (typeof payload === 'string') return payload;
  try {
    const s = JSON.stringify(payload);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return String(payload);
  }
}

export default async function AuditPage() {
  const res = await apiGet<AuditEvent[]>(tenantPath('/audit'));

  return (
    <>
      <div className="page-head">
        <h2>Audit log</h2>
        <p>Immutable event stream of policy decisions, actions, and escalations.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h3>No audit events</h3>
          <p>Events are recorded as the assistant takes actions.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Conversation</th>
                <th>Detail</th>
                <th>At</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="badge badge-soft">{e.eventType}</span>
                  </td>
                  <td className="mono">{e.conversationId || '—'}</td>
                  <td className="mono muted" style={{ maxWidth: 380 }}>
                    {summarizePayload(e.payload)}
                  </td>
                  <td className="muted">{fmtDate(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
