import Link from 'next/link';
import { apiGet, tenantPath, ConversationSummary } from '../lib/api';
import { OfflineState, StatusBadge, fmtDate } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage() {
  const res = await apiGet<ConversationSummary[]>(tenantPath('/conversations'));

  return (
    <>
      <div className="page-head">
        <h2>Conversations</h2>
        <p>Every session handled by the assistant, across all channels.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h3>No conversations yet</h3>
          <p>Conversations will appear here once end-users start chatting.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Channel</th>
                <th>State</th>
                <th>Status</th>
                <th className="num">Turns</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link className="link" href={`/conversations/${c.id}`}>
                      {c.displayName || c.id}
                    </Link>
                  </td>
                  <td>
                    <span className="badge badge-outline">{c.channel}</span>
                  </td>
                  <td className="mono">{c.state}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="num">{c.turns}</td>
                  <td className="muted">{fmtDate(c.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
