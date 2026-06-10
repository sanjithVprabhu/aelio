import KnowledgeClient from './KnowledgeClient';

export const dynamic = 'force-dynamic';

export default function KnowledgePage() {
  return (
    <>
      <div className="page-head">
        <h2>Knowledge</h2>
        <p>Grounding collections the assistant draws on. Add text, test retrieval, and curate sources.</p>
      </div>
      <KnowledgeClient />
    </>
  );
}
