'use client';

import React, { useState } from 'react';
import { AppShell } from '../components/Rail';
import { useApi, PageBody, PageHead, Loading, ErrorState, Empty, TableWrap, th, td } from '../components/data';
import { api } from '../lib/api';

export default function SpecsPage() {
  const { data, loading, error, reload } = useApi<any[]>('/actions');
  const [raw, setRaw] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [exposeAll, setExposeAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function ingest() {
    setBusy(true);
    setResult(null);
    try {
      const body: any = { exposeAll };
      if (raw.trim()) body.raw = raw.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      const r = await api<{ format: string; actionCount: number; warnings?: string[] }>('/specs', { method: 'POST', body });
      setResult(`✓ Ingested ${r.format} spec — ${r.actionCount} actions${r.warnings?.length ? ` · ${r.warnings.length} warnings` : ''}`);
      reload();
    } catch (e: any) {
      setResult('Error: ' + (e?.message || 'ingest failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Specs" breadcrumb="Connect">
      <PageBody>
        <PageHead title="Specs & Actions" sub="Ingest an OpenAPI spec to generate callable actions." />

        <div style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={sectionLbl}>Ingest a spec</div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="Paste OpenAPI JSON here" style={{ ...inp, minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical', marginBottom: 10 }} />
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="…or base URL (https://api.example.com/openapi.json)" style={{ ...inp, marginBottom: 12 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={exposeAll} onChange={(e) => setExposeAll(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--black)' }} />
            Expose all discovered actions immediately
          </label>
          <button onClick={ingest} disabled={busy || (!raw.trim() && !baseUrl.trim())} style={{ ...darkBtn, opacity: busy || (!raw.trim() && !baseUrl.trim()) ? 0.5 : 1 }}>
            {busy ? 'Ingesting…' : 'Ingest spec'}
          </button>
          {result && <div style={{ marginTop: 12, fontSize: 13, fontWeight: 500, color: result.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{result}</div>}
        </div>

        <div style={sectionLbl}>Generated actions</div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data || data.length === 0 ? (
          <Empty title="No actions yet" hint="Ingest a spec above to generate actions." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th style={th}>Action</th>
                <th style={th}>Method</th>
                <th style={th}>Path</th>
                <th style={th}>Tier</th>
                <th style={th}>Exposed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{a.label}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, fontWeight: 700 }}>{a.method}</td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--ink-45)' }}>{a.path}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: '#fff', background: ['var(--green)', 'var(--blue)', 'var(--amber)', 'var(--red)'][a.tier] || 'var(--ink-45)' }}>TIER {a.tier}</span>
                  </td>
                  <td style={td}>{a.exposed ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>Yes</span> : <span style={{ color: 'var(--ink-45)' }}>No</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </PageBody>
    </AppShell>
  );
}

const darkBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--ink-22)', borderRadius: 8, padding: '9px 12px', fontSize: 13.5, fontFamily: 'inherit', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
const sectionLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-45)', marginBottom: 12 };
