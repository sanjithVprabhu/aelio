import { apiGet, tenantPath, EndUser } from '../lib/api';
import { OfflineState, StatusBadge } from '../components/ui';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const res = await apiGet<EndUser[]>(tenantPath('/end-users'));

  return (
    <>
      <div className="page-head">
        <h2>Users</h2>
        <p>End-users seen across conversations, with verification and current state.</p>
      </div>

      {!res.ok ? (
        <OfflineState error={res.error} />
      ) : res.data.length === 0 ? (
        <div className="empty">
          <h3>No end-users yet</h3>
          <p>Users appear here after their first verified interaction.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>External ID</th>
                <th>Plan</th>
                <th>Verification</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName || '—'}</td>
                  <td className="mono">{u.externalUserId}</td>
                  <td>
                    <span className="badge badge-outline">{u.plan}</span>
                  </td>
                  <td>
                    <StatusBadge status={u.verificationStatus} />
                  </td>
                  <td className="mono">{u.currentUserState}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
