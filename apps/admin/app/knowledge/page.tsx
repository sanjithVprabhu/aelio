'use client';

import React, { useState } from 'react';
import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty } from '../components/data';
import { api } from '../lib/api';

export default function KnowledgePage() {
  const { data, loading, error, reload } = useApi<any[]>('/kb/collections');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<any | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/kb/collections', { method: 'POST', body: { name: name.trim(), description: desc.trim() } });
      setName('');
      setDesc('');
      setCreating(false);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Knowledge"
      breadcrumb="Build"
      actions={
        <button onClick={() => setCreating((c) => !c)} style={topBtn}>
          + New collection
        </button>
      }
    >
      <PageBody>
        <PageHead title="Knowledge" sub="Collections your agent can search to answer questions." />
        {creating && (
          <div style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              <label style={lbl}>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inp} placeholder="e.g. Billing FAQ" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              <label style={lbl}>Description</label>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} style={inp} placeholder="What's in here" />
            </div>
            <button onClick={create} disabled={busy || !name.trim()} style={{ ...darkBtn, opacity: busy || !name.trim() ? 0.5 : 1 }}>
              {busy ? 'Creating…' : 'Create collection'}
            </button>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No collections yet" hint="Create one to give your agent knowledge to draw on." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {data.map((k) => (
              <div key={k.id} style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{k.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-70)', marginBottom: 14, minHeight: 18 }}>{k.description || '—'}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--ink-45)', marginBottom: 14 }}>
                  <span>{k.sources ?? 0} sources</span>
                  <span>{k.chunks ?? 0} chunks</span>
                </div>
                <button onClick={() => setSel(k)} style={{ ...ghostBtn, width: '100%' }}>
                  Manage & test
                </button>
              </div>
            ))}
          </div>
        )}
      </PageBody>
      {sel && <CollectionDrawer collection={sel} onClose={() => setSel(null)} onChanged={reload} />}
    </AppShell>
  );
}

function CollectionDrawer({ collection, onClose, onChanged }: { collection: any; onClose: () => void; onChanged: () => void }) {
  const [srcName, setSrcName] = useState('');
  const [content, setContent] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addSource() {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api(`/kb/collections/${collection.id}/sources`, { method: 'POST', body: { type: 'text', name: srcName.trim() || 'Untitled', content: content.trim() } });
      setSrcName('');
      setContent('');
      setMsg('Source added');
      onChanged();
    } catch (e: any) {
      setMsg('Failed: ' + (e?.message || ''));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2000);
    }
  }

  async function test() {
    if (!query.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api(`/kb/collections/${collection.id}/test`, { method: 'POST', body: { query: query.trim() } });
      setResult(JSON.stringify(r, null, 2));
    } catch (e: any) {
      setResult('Error: ' + (e?.message || ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,.34)', zIndex: 50, display: 'flex' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ marginLeft: 'auto', width: 'min(480px, 92vw)', height: '100%', background: 'var(--white)', borderLeft: '1px solid var(--ink-10)', overflowY: 'auto', padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 22 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{collection.name}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, color: 'var(--ink-45)', cursor: 'pointer' }}>
            ×
          </button>
        </div>
        {msg && <div style={{ fontSize: 12.5, marginBottom: 14, color: msg.startsWith('Failed') ? 'var(--red)' : 'var(--green)' }}>{msg}</div>}

        <div style={sectionLbl}>Add a text source</div>
        <input value={srcName} onChange={(e) => setSrcName(e.target.value)} placeholder="Source name" style={{ ...inp, marginBottom: 8 }} />
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste content the agent should know…" style={{ ...inp, minHeight: 120, resize: 'vertical', marginBottom: 8 }} />
        <button onClick={addSource} disabled={busy || !content.trim()} style={{ ...darkBtn, opacity: busy || !content.trim() ? 0.5 : 1, marginBottom: 28 }}>
          Add source
        </button>

        <div style={sectionLbl}>Test retrieval</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && test()} placeholder="Ask a question…" style={{ ...inp, flex: 1 }} />
          <button onClick={test} disabled={busy || !query.trim()} style={{ ...darkBtn, opacity: busy || !query.trim() ? 0.5 : 1 }}>
            Test
          </button>
        </div>
        {result && (
          <pre style={{ background: 'var(--black)', color: '#e8e2d8', borderRadius: 9, padding: 14, fontSize: 11.5, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflow: 'auto' }}>{result}</pre>
        )}
      </div>
    </div>
  );
}

const topBtn: React.CSSProperties = { padding: '6px 13px', fontSize: 12.5, fontWeight: 600, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const darkBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--white)', color: 'var(--ink-70)', border: '1px solid var(--ink-10)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--ink-22)', borderRadius: 8, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--ink-70)' };
const sectionLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-45)', marginBottom: 12 };
