import InboxClient from './InboxClient';

export const dynamic = 'force-dynamic';

export default function InboxPage() {
  return (
    <>
      <div className="page-head">
        <h2>Inbox</h2>
        <p>Escalations waiting for a human. Claim, reply, and resolve.</p>
      </div>
      <InboxClient />
    </>
  );
}
