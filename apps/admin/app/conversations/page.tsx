'use client';

import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty, TableWrap, th, td } from '../components/data';

export default function ConversationsPage() {
  const { data, loading, error, reload } = useApi<any[]>('/conversations');
  return (
    <AppShell title="Conversations" breadcrumb="Observe">
      <PageBody>
        <PageHead title="Conversations" sub="Every session your agent has handled." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No conversations yet" hint="Sessions will appear here once users start chatting." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={th}>ID</th>
                <th style={th}>User</th>
                <th style={th}>State</th>
                <th style={th}>Messages</th>
                <th style={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{String(c.id).slice(0, 10)}</td>
                  <td style={td}>{c.externalUserId || c.userId || c.displayName || '—'}</td>
                  <td style={td}>{c.state || c.currentUserState || '—'}</td>
                  <td style={td}>{c.messageCount ?? c.turns ?? '—'}</td>
                  <td style={{ ...td, color: 'var(--ink-45)' }}>{c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </PageBody>
    </AppShell>
  );
}
