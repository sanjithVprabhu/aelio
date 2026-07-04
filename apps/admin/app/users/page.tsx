'use client';

import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty, TableWrap, th, td } from '../components/data';

const STATE_DOT: Record<string, string> = {
  unverified: '#9598A1',
  onboarding: '#3C9B6A',
  active: '#3562C8',
  power_user: '#C4612A',
  at_risk: '#C43838',
};

export default function UsersPage() {
  const { data, loading, error, reload } = useApi<any[]>('/end-users');
  return (
    <AppShell title="Users" breadcrumb="Observe">
      <PageBody>
        <PageHead title="Users" sub="Everyone who has interacted with your agent." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No users yet" />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={th}>User</th>
                <th style={th}>External ID</th>
                <th style={th}>Verification</th>
                <th style={th}>State</th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{u.displayName || u.name || '—'}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--ink-45)' }}>{u.externalUserId || '—'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 9px', borderRadius: 999, background: u.verificationStatus === 'verified' ? 'var(--green-bg)' : 'var(--ink-05)', color: u.verificationStatus === 'verified' ? 'var(--green)' : 'var(--ink-70)' }}>
                      {u.verificationStatus || 'unknown'}
                    </span>
                  </td>
                  <td style={td}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATE_DOT[u.currentUserState] || 'var(--ink-22)' }} />
                      {u.currentUserState || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </PageBody>
    </AppShell>
  );
}
