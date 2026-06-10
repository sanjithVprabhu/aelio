'use client';

import { useEffect, useState } from 'react';
import { tapi } from '../lib/client';
import { fmtDate } from '../components/ui';
import {
  Modal,
  Spinner,
  Toast,
  useAsync,
  OfflineBlock,
  LoadingBlock,
  errMessage,
} from '../components/client-ui';

type Settings = {
  llm: { mode: string; provider: string; model: string };
  compliance: { region: string; retention: string; piiRedaction: boolean };
  plan: string;
};

export default function SettingsClient() {
  return (
    <>
      <LlmSection />
      <TeamSection />
      <ComplianceSection />
      <BillingSection />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function LlmSection() {
  const { data, error, loading } = useAsync<Settings>(() => tapi.get<Settings>('/settings'));
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (data) {
      setProvider(data.llm.provider ?? '');
      setModel(data.llm.model ?? '');
      setMode(data.llm.mode ?? '');
    }
  }, [data]);

  if (loading) return <Section title="LLM"><LoadingBlock /></Section>;
  if (error || !data) return <Section title="LLM"><OfflineBlock error={error ?? 'No data'} /></Section>;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await tapi.patch('/settings/llm', { provider, model, mode });
      setMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: errMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTestBusy(true);
    setMsg(null);
    try {
      const res = await tapi.post<{ ok: boolean; model?: string; provider?: string; error?: string }>(
        '/settings/llm/test',
      );
      setMsg(
        res.ok
          ? { kind: 'ok', text: `Connected · ${res.provider} / ${res.model}` }
          : { kind: 'err', text: res.error ?? 'Connection failed' },
      );
    } catch (e) {
      setMsg({ kind: 'err', text: errMessage(e) });
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Section title="LLM">
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>Mode</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="platform">platform</option>
            <option value="byok">byok</option>
          </select>
        </div>
        <div className="field">
          <label>Provider</label>
          <input className="input" value={provider} onChange={(e) => setProvider(e.target.value)} />
        </div>
        <div className="field">
          <label>Model</label>
          <input className="input mono" value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
        <div className="btn-row">
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save'}
          </button>
          <button className="btn btn-ghost" onClick={test} disabled={testBusy}>
            {testBusy ? <Spinner /> : 'Test connection'}
          </button>
          {msg && <Toast kind={msg.kind}>{msg.text}</Toast>}
        </div>
      </div>
    </Section>
  );
}

type Member = { id: string; email: string; name: string; role: string; joinedAt: string };

function TeamSection() {
  const { data, error, loading, reload } = useAsync<Member[]>(() =>
    tapi.get<Member[]>('/team/members'),
  );
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading) return <Section title="Team"><LoadingBlock /></Section>;
  if (error || !data) return <Section title="Team"><OfflineBlock error={error ?? 'No data'} /></Section>;

  async function changeRole(id: string, role: string) {
    setBusyId(id);
    try {
      await tapi.patch(`/team/members/${id}/role`, { role });
      reload();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this member?')) return;
    setBusyId(id);
    try {
      await tapi.del(`/team/members/${id}`);
      reload();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title="Team">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => setInviting(true)}>
          Invite member
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ fontWeight: 500 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.email}
                  </div>
                </td>
                <td>
                  <select
                    className="select"
                    style={{ width: 'auto', padding: '5px 9px', fontSize: 12.5 }}
                    value={m.role}
                    disabled={busyId === m.id}
                    onChange={(e) => changeRole(m.id, e.target.value)}
                  >
                    <option value="owner">owner</option>
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                </td>
                <td className="muted">{fmtDate(m.joinedAt)}</td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    disabled={busyId === m.id}
                    onClick={() => remove(m.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inviting && (
        <InviteModal
          onClose={() => setInviting(false)}
          onInvited={() => {
            setInviting(false);
            reload();
          }}
        />
      )}
    </Section>
  );
}

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function invite() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await tapi.post<{ invited: boolean; devTempPassword?: string }>('/team/invites', {
        email,
        name,
        role,
      });
      setMsg({
        kind: 'ok',
        text: res.devTempPassword
          ? `Invited. Temp password: ${res.devTempPassword}`
          : 'Invited.',
      });
      setTimeout(onInvited, 1200);
    } catch (e) {
      setMsg({ kind: 'err', text: errMessage(e) });
      setBusy(false);
    }
  }

  return (
    <Modal title="Invite member" sub="They join tenant acme." onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>Role</label>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </div>
      {msg && <div style={{ marginBottom: 12 }}><Toast kind={msg.kind}>{msg.text}</Toast></div>}
      <div className="btn-row">
        <button className="btn" onClick={invite} disabled={busy || !email.trim() || !name.trim()}>
          {busy ? <Spinner /> : 'Send invite'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function ComplianceSection() {
  const [externalUserId, setExternalUserId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function dsar() {
    setBusy('dsar');
    setResult(null);
    try {
      const res = await tapi.post('/settings/compliance/dsar', { externalUserId });
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function erasure() {
    if (!confirm(`Permanently erase all data for "${externalUserId}"? This cannot be undone.`)) return;
    setBusy('erasure');
    setResult(null);
    try {
      const res = await tapi.post('/settings/compliance/erasure', { externalUserId });
      setResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setResult(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Compliance">
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="field">
          <label>External user ID</label>
          <input
            className="input mono"
            value={externalUserId}
            onChange={(e) => setExternalUserId(e.target.value)}
            placeholder="ext_demo"
          />
          <span className="hint">Run a data subject access request or a right-to-erasure.</span>
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={dsar} disabled={!!busy || !externalUserId.trim()}>
            {busy === 'dsar' ? <Spinner /> : 'DSAR lookup'}
          </button>
          <button className="btn btn-danger" onClick={erasure} disabled={!!busy || !externalUserId.trim()}>
            {busy === 'erasure' ? <Spinner /> : 'Erase data'}
          </button>
        </div>
        {result && (
          <pre className="codeblock" style={{ marginTop: 14 }}>
            {result}
          </pre>
        )}
      </div>
    </Section>
  );
}

type Billing = {
  plan: string;
  provider: string;
  usage: { conversations: number; actionInvocations: number; seats: number };
  conversationLimit: number;
};

function BillingSection() {
  const { data, error, loading } = useAsync<Billing>(() => tapi.get<Billing>('/billing'));

  if (loading) return <Section title="Billing"><LoadingBlock /></Section>;
  if (error || !data) return <Section title="Billing"><OfflineBlock error={error ?? 'No data'} /></Section>;

  const pctUsed = data.conversationLimit
    ? Math.min(100, (data.usage.conversations / data.conversationLimit) * 100)
    : 0;

  return (
    <Section title="Billing">
      <div className="cards-grid">
        <div className="card">
          <p className="card-title">Plan</p>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', textTransform: 'capitalize' }}>
            {data.plan}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            billing via {data.provider}
          </div>
        </div>
        <div className="card">
          <p className="card-title">Usage</p>
          <dl className="kv">
            <dt>Conversations</dt>
            <dd>
              {data.usage.conversations} / {data.conversationLimit}
            </dd>
            <dt>Action calls</dt>
            <dd>{data.usage.actionInvocations}</dd>
            <dt>Seats</dt>
            <dd>{data.usage.seats}</dd>
          </dl>
          <div className="bar-track" style={{ marginTop: 12 }}>
            <span className="bar-fill" style={{ width: `${pctUsed}%` }} />
          </div>
        </div>
      </div>
    </Section>
  );
}
