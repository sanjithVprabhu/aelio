import EditorClient from './EditorClient';

export const dynamic = 'force-dynamic';

export default function PlaybookEditorPage() {
  return (
    <>
      <div className="page-head">
        <h2>Playbook editor</h2>
        <p>Shape the conversation: lifecycle states, transition triggers, and the fallback ladder.</p>
      </div>
      <EditorClient />
    </>
  );
}
