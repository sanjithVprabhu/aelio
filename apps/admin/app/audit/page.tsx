'use client';

import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty, TableWrap, th, td } from '../components/data';

export default function AuditPage() {
  const { data, loading, error, reload } = useApi<any[]>('/audit');
  return (
    <AppShell title="Audit log" breadcrumb="Observe">
      <PageBody>
        <PageHead title="Audit log" sub="A record of every privileged action and configuration change." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No audit events yet" hint="Configuration changes and action invocations will be logged here." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Actor</th>
                <th style={th}>Event</th>
                <th style={th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e, i) => (
                <tr key={e.id || i}>
                  <td style={{ ...td, color: 'var(--ink-45)', whiteSpace: 'nowrap' }}>{e.createdAt || e.timestamp ? new Date(e.createdAt || e.timestamp).toLocaleString() : '—'}</td>
                  <td style={td}>{e.actor || e.actorEmail || e.userId || 'system'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{e.event || e.action || e.type || '—'}</span>
                  </td>
                  <td style={{ ...td, color: 'var(--ink-70)' }}>{typeof e.detail === 'object' ? JSON.stringify(e.detail) : e.detail || e.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </PageBody>
    </AppShell>
  );
}
