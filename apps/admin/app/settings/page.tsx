'use client';

import React, { useEffect, useState } from 'react';
import { AppShell } from '../components/Rail';
import { PageBody, PageHead, Loading, ErrorState } from '../components/data';
import { api, getToken } from '../lib/api';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<any | null>(null);
  const [team, setTeam] = useState<any[] | null>(null);
  const [billing, setBilling] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([api('/settings'), api('/team/members'), api('/billing')])
      .then(([s, t, b]) => {
        setSettings(s);
        setTeam(t as any[]);
        setBilling(b);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.message || 'Failed to load settings');
        setLoading(false);
      });
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && !getToken()) {
      router.replace('/login');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell title="Settings" breadcrumb="Develop">
      <PageBody>
        <PageHead title="Settings" sub="LLM provider, team, and billing." />
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <LlmCard settings={settings} onSaved={load} />
            <TeamCard team={team || []} onChanged={load} />
            <BillingCard billing={billing} />
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 12, padding: 22 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-45)', marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

function LlmCard({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const [provider, setProvider] = useState(settings?.llm?.provider || 'scripted');
  const [model, setModel] = useState(settings?.llm?.model || '');
  const [mode, setMode] = useState(settings?.llm?.mode || 'platform');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api('/settings/llm', { method: 'PATCH', body: { provider, model, mode } });
      setMsg('Saved');
      onSaved();
    } catch (e: any) {
      setMsg('Failed: ' + (e?.message || ''));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 2200);
    }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api('/settings/llm/test', { method: 'POST', body: {} });
      setMsg('Test OK: ' + JSON.stringify(r).slice(0, 80));
    } catch (e: any) {
      setMsg('Test failed: ' + (e?.message || ''));
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 3000);
    }
  }

  return (
    <Card title="LLM provider">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div>
          <label style={lbl}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={inp}>
            <option value="platform">Platform-managed</option>
            <option value="byok">Bring your own key</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Provider</label>
          <input value={provider} onChange={(e) => setProvider(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>Model</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} style={inp} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button onClick={save} disabled={busy} style={{ ...darkBtn, opacity: busy ? 0.6 : 1 }}>
          Save
        </button>
        <button onClick={test} disabled={busy} style={ghostBtn}>
          Test connection
        </button>
        {msg && <span style={{ fontSize: 12.5, color: msg.includes('failed') || msg.includes('Failed') ? 'var(--red)' : 'var(--green)' }}>{msg}</span>}
      </div>
    </Card>
  );
}

function TeamCard({ team, onChanged }: { team: any[]; onChanged: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);

  async function invite() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      await api('/team/invites', { method: 'POST', body: { email: email.trim(), name: name.trim() || email.split('@')[0], role } });
      setEmail('');
      setName('');
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(id: string, r: string) {
    await api(`/team/members/${id}/role`, { method: 'PATCH', body: { role: r } });
    onChanged();
  }
  async function remove(id: string) {
    await api(`/team/members/${id}`, { method: 'DELETE' });
    onChanged();
  }

  return (
    <Card title="Team">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {team.map((m) => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--ink-05)' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--black)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {(m.name || m.email || '?').slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name || '—'}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-45)' }}>{m.email}</div>
            </div>
            <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)} disabled={m.role === 'owner'} style={{ ...inp, width: 'auto', fontSize: 12.5, padding: '5px 8px' }}>
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="member">member</option>
            </select>
            {m.role !== 'owner' && (
              <button onClick={() => remove(m.id)} style={{ background: 'none', border: 'none', color: 'var(--ink-22)', cursor: 'pointer', fontSize: 18 }} title="Remove">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={lbl}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@acme.com" style={inp} />
        </div>
        <div style={{ width: 120 }}>
          <label style={lbl}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} style={inp}>
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
        </div>
        <button onClick={invite} disabled={busy || !email.trim()} style={{ ...darkBtn, opacity: busy || !email.trim() ? 0.5 : 1 }}>
          Invite
        </button>
      </div>
    </Card>
  );
}

function BillingCard({ billing }: { billing: any }) {
  if (!billing) return null;
  const usage = billing.usage || {};
  return (
    <Card title="Billing">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 22, fontWeight: 700, textTransform: 'capitalize' }}>{billing.plan}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-45)' }}>via {billing.provider}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
        {[
          ['Conversations', usage.conversations ?? 0, billing.conversationLimit],
          ['Action invocations', usage.actionInvocations ?? 0, null],
          ['Seats', usage.seats ?? 0, null],
        ].map(([label, val, limit]) => (
          <div key={label as string} style={{ border: '1px solid var(--ink-10)', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-45)', marginBottom: 6 }}>{label as string}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {val as number}
              {limit ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--ink-45)' }}> / {limit as number}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const darkBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const ghostBtn: React.CSSProperties = { padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--white)', color: 'var(--ink-70)', border: '1px solid var(--ink-10)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' };
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--ink-22)', borderRadius: 8, padding: '8px 11px', fontSize: 13, fontFamily: 'inherit', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-70)', marginBottom: 6 };
