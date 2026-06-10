import SettingsClient from './SettingsClient';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <>
      <div className="page-head">
        <h2>Settings</h2>
        <p>Model, team, compliance, and billing configuration for tenant acme.</p>
      </div>
      <SettingsClient />
    </>
  );
}
