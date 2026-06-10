import ActionsClient from './ActionsClient';

export const dynamic = 'force-dynamic';

export default function ActionsPage() {
  return (
    <>
      <div className="page-head">
        <h2>Actions</h2>
        <p>The capability surface — which API actions the assistant may take, and under what policy.</p>
      </div>
      <ActionsClient />
    </>
  );
}
