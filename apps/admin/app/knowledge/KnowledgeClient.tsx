'use client';

import { useState } from 'react';
import { tapi } from '../lib/client';
import {
  Modal,
  Spinner,
  useAsync,
  OfflineBlock,
  LoadingBlock,
  errMessage,
} from '../components/client-ui';

type Collection = {
  id: string;
  name: string;
  description?: string;
  sources: number;
  chunks: number;
  embeddingModel?: string;
};

type Chunk = { text?: string; content?: string; score?: number; [k: string]: unknown };

export default function KnowledgeClient() {
  const { data, error, loading, reload } = useAsync<Collection[]>(() =>
    tapi.get<Collection[]>('/kb/collections'),
  );
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <OfflineBlock error={error ?? 'No data'} />;

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={() => setCreating(true)}>
          New collection
        </button>
      </div>

      {data.length === 0 ? (
        <div className="empty">
          <h3>No knowledge collections</h3>
          <p>Create a collection and add a source to ground the assistant&apos;s answers.</p>
        </div>
      ) : (
        <div className="cards-grid">
          {data.map((col) => (
            <div className="card" key={col.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{col.name}</h4>
                  {col.description && (
                    <p style={{ margin: '4px 0 0', color: 'var(--ink-70)', fontSize: 13 }}>
                      {col.description}
                    </p>
                  )}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setActive((a) => (a === col.id ? null : col.id))}
                >
                  {active === col.id ? 'Close' : 'Manage'}
                </button>
              </div>
              <div className="btn-row" style={{ marginTop: 12, fontSize: 12.5 }}>
                <span className="badge badge-soft">{col.sources} sources</span>
                <span className="badge badge-soft">{col.chunks} chunks</span>
                {col.embeddingModel && (
                  <span className="badge badge-outline mono">{col.embeddingModel}</span>
                )}
              </div>

              {active === col.id && (
                <CollectionPanel collectionId={col.id} onChanged={reload} />
              )}
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await tapi.post('/kb/collections', { name, description });
      onCreated();
    } catch (e) {
      setErr(errMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="New collection" sub="Group related grounding sources." onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {err && <div style={{ marginBottom: 12 }}><span className="toast toast-err">{err}</span></div>}
      <div className="btn-row">
        <button className="btn" onClick={create} disabled={busy || !name.trim()}>
          {busy ? <Spinner /> : 'Create'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function CollectionPanel({
  collectionId,
  onChanged,
}: {
  collectionId: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  // We don't have a list-sources endpoint exposed for IDs to delete by row, so
  // we surface a delete-by-id input (the API deletes by source id).
  const [delId, setDelId] = useState('');
  const [delBusy, setDelBusy] = useState(false);

  async function addSource() {
    setAddBusy(true);
    setAddMsg(null);
    try {
      await tapi.post(`/kb/collections/${collectionId}/sources`, {
        type: 'text',
        name,
        content,
      });
      setAddMsg('Source added.');
      setName('');
      setContent('');
      onChanged();
    } catch (e) {
      setAddMsg(errMessage(e));
    } finally {
      setAddBusy(false);
    }
  }

  async function runTest() {
    setTestBusy(true);
    setChunks(null);
    try {
      const res = await tapi.post<{ chunks: Chunk[] }>(`/kb/collections/${collectionId}/test`, {
        query,
      });
      setChunks(res.chunks ?? []);
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setTestBusy(false);
    }
  }

  async function deleteSource() {
    if (!delId.trim()) return;
    setDelBusy(true);
    try {
      await tapi.del(`/kb/collections/${collectionId}/sources/${delId.trim()}`);
      setDelId('');
      onChanged();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setDelBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hairline-soft)' }}>
      <p className="card-title">Add text source</p>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Content</label>
        <textarea className="textarea" value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div className="btn-row">
        <button className="btn btn-sm" onClick={addSource} disabled={addBusy || !name.trim() || !content.trim()}>
          {addBusy ? <Spinner /> : 'Add source'}
        </button>
        {addMsg && <span className="muted" style={{ fontSize: 12 }}>{addMsg}</span>}
      </div>

      <p className="card-title" style={{ marginTop: 22 }}>
        Test retrieval
      </p>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question…"
        />
        <button className="btn btn-sm" onClick={runTest} disabled={testBusy || !query.trim()}>
          {testBusy ? <Spinner /> : 'Search'}
        </button>
      </div>
      {chunks && (
        <div>
          {chunks.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5 }}>
              No chunks matched.
            </p>
          ) : (
            chunks.map((ch, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--hairline)',
                  borderRadius: 9,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span className="muted" style={{ fontSize: 11 }}>
                    chunk {i + 1}
                  </span>
                  {typeof ch.score === 'number' && (
                    <span className="badge badge-soft">score {ch.score.toFixed(3)}</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-70)' }}>
                  {String(ch.text ?? ch.content ?? JSON.stringify(ch))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <p className="card-title" style={{ marginTop: 22 }}>
        Delete source
      </p>
      <div className="btn-row">
        <input
          className="input mono"
          style={{ flex: 1, minWidth: 180 }}
          value={delId}
          onChange={(e) => setDelId(e.target.value)}
          placeholder="source id"
        />
        <button className="btn btn-ghost btn-sm btn-danger" onClick={deleteSource} disabled={delBusy || !delId.trim()}>
          {delBusy ? <Spinner /> : 'Delete'}
        </button>
      </div>
    </div>
  );
}
