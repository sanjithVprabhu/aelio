'use client';

import Link from 'next/link';
import { useState } from 'react';
import { tapi } from '../lib/client';
import { StatusBadge, fmtDate } from '../components/ui';
import {
  Modal,
  Spinner,
  Toast,
  useAsync,
  OfflineBlock,
  LoadingBlock,
  errMessage,
} from '../components/client-ui';

type Version = {
  id: string;
  version: string;
  status: string;
  deploymentMode?: string;
  gradualRolloutPercent?: number;
  states: number;
  publishedAt?: string;
};

type Preflight = { ok: boolean; checks: { label: string; passed: boolean; blocker: boolean }[] };

export default function PlaybooksClient() {
  const { data, error, loading, reload } = useAsync<Version[]>(() =>
    tapi.get<Version[]>('/playbooks'),
  );
  const [deploying, setDeploying] = useState<Version | null>(null);
  const [preflightFor, setPreflightFor] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Record<string, Preflight | string>>({});
  const [newBusy, setNewBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <OfflineBlock error={error ?? 'No data'} />;

  async function newDraft() {
    setNewBusy(true);
    try {
      await tapi.post('/playbooks');
      reload();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setNewBusy(false);
    }
  }

  async function archive(v: Version) {
    if (!confirm(`Archive version ${v.version}?`)) return;
    setBusyId(v.id);
    try {
      await tapi.post(`/playbooks/${v.id}/archive`);
      reload();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function loadPreflight(v: Version) {
    if (preflightFor === v.id) {
      setPreflightFor(null);
      return;
    }
    setPreflightFor(v.id);
    if (preflight[v.id]) return;
    try {
      const res = await tapi.get<Preflight>(`/playbooks/${v.id}/preflight`);
      setPreflight((p) => ({ ...p, [v.id]: res }));
    } catch (e) {
      setPreflight((p) => ({ ...p, [v.id]: errMessage(e) }));
    }
  }

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <Link className="btn" href="/playbooks/editor">
          Open visual editor
        </Link>
        <button className="btn btn-ghost" onClick={newDraft} disabled={newBusy}>
          {newBusy ? <Spinner /> : 'New draft'}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
              <th>Mode</th>
              <th className="num">States</th>
              <th>Published</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <PlaybookRow
                key={v.id}
                v={v}
                busy={busyId === v.id}
                preflightOpen={preflightFor === v.id}
                preflight={preflight[v.id]}
                onDeploy={() => setDeploying(v)}
                onArchive={() => archive(v)}
                onPreflight={() => loadPreflight(v)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {deploying && (
        <DeployModal
          version={deploying}
          onClose={() => setDeploying(null)}
          onDeployed={() => {
            setDeploying(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlaybookRow({
  v,
  busy,
  preflightOpen,
  preflight,
  onDeploy,
  onArchive,
  onPreflight,
}: {
  v: Version;
  busy: boolean;
  preflightOpen: boolean;
  preflight?: Preflight | string;
  onDeploy: () => void;
  onArchive: () => void;
  onPreflight: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <span className="chip">v{v.version}</span>
        </td>
        <td>
          <StatusBadge status={v.status} />
        </td>
        <td className="muted">
          {v.deploymentMode ?? '—'}
          {v.deploymentMode === 'gradual' && v.gradualRolloutPercent != null
            ? ` (${v.gradualRolloutPercent}%)`
            : ''}
        </td>
        <td className="num">{v.states}</td>
        <td className="muted">{v.publishedAt ? fmtDate(v.publishedAt) : '—'}</td>
        <td>
          <div className="btn-row">
            <Link className="btn btn-ghost btn-sm" href="/playbooks/editor">
              Edit
            </Link>
            <button className="btn btn-ghost btn-sm" onClick={onPreflight}>
              Preflight
            </button>
            <button className="btn btn-sm" onClick={onDeploy} disabled={busy}>
              Deploy
            </button>
            {v.status !== 'archived' && (
              <button className="btn btn-ghost btn-sm btn-danger" onClick={onArchive} disabled={busy}>
                {busy ? <Spinner /> : 'Archive'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {preflightOpen && (
        <tr>
          <td colSpan={6} style={{ background: 'rgba(10,10,10,0.012)' }}>
            <PreflightView data={preflight} />
          </td>
        </tr>
      )}
    </>
  );
}

function PreflightView({ data }: { data?: Preflight | string }) {
  if (!data) return <span className="muted">Loading preflight…</span>;
  if (typeof data === 'string') return <span className="status-bad">{data}</span>;
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <span className={`badge badge-soft ${data.ok ? 'status-ok' : 'status-bad'}`}>
          {data.ok ? 'Ready to deploy' : 'Blocked'}
        </span>
      </div>
      {data.checks.map((c, i) => (
        <div key={i} className="checklist-item" style={{ padding: '8px 0' }}>
          <span
            className="check-icon"
            style={{ background: c.passed ? 'var(--tier-0)' : c.blocker ? 'var(--tier-3)' : 'var(--tier-2)' }}
          >
            {c.passed ? '✓' : '!'}
          </span>
          <span style={{ fontSize: 13 }}>{c.label}</span>
          {!c.blocker && <span className="muted" style={{ fontSize: 11.5 }}>(non-blocking)</span>}
        </div>
      ))}
    </div>
  );
}

function DeployModal({
  version,
  onClose,
  onDeployed,
}: {
  version: Version;
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [mode, setMode] = useState<'immediate' | 'shadow' | 'gradual'>('immediate');
  const [percent, setPercent] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function deploy() {
    setBusy(true);
    setMsg(null);
    try {
      await tapi.post(`/playbooks/${version.id}/deploy`, {
        mode,
        gradualRolloutPercent: mode === 'gradual' ? Number(percent) || 0 : undefined,
      });
      setMsg({ kind: 'ok', text: 'Deployed.' });
      setTimeout(onDeployed, 800);
    } catch (e) {
      setMsg({ kind: 'err', text: errMessage(e) });
      setBusy(false);
    }
  }

  return (
    <Modal title={`Deploy v${version.version}`} sub="Choose how this version rolls out." onClose={onClose}>
      <div className="field">
        <label>Mode</label>
        <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="immediate">Immediate — make it the active version</option>
          <option value="shadow">Shadow — run alongside, no user impact</option>
          <option value="gradual">Gradual — roll out to a percentage</option>
        </select>
      </div>
      {mode === 'gradual' && (
        <div className="field">
          <label>Rollout percent</label>
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
          />
        </div>
      )}
      {msg && <div style={{ marginBottom: 12 }}><Toast kind={msg.kind}>{msg.text}</Toast></div>}
      <div className="btn-row">
        <button className="btn" onClick={deploy} disabled={busy}>
          {busy ? <Spinner /> : 'Deploy'}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
