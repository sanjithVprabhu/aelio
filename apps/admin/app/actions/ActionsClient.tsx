'use client';

import { useState } from 'react';
import { tapi } from '../lib/client';
import { TierBadge, MethodBadge } from '../components/ui';
import {
  Drawer,
  Toast,
  Spinner,
  ToggleButton,
  useAsync,
  OfflineBlock,
  LoadingBlock,
  errMessage,
} from '../components/client-ui';

type Action = {
  id: string;
  key: string;
  label: string;
  method: string;
  path: string;
  tier: number;
  exposed: boolean;
  stepUpRequired: boolean;
  rateLimitPerUserPerHour: number;
  description: string;
  confirmationCopy?: string;
};

const TIERS = [
  { v: 0, label: 'T0 · Read' },
  { v: 1, label: 'T1 · Low-risk write' },
  { v: 2, label: 'T2 · Sensitive' },
  { v: 3, label: 'T3 · High-risk' },
];

export default function ActionsClient() {
  const { data, error, loading, reload, setData } = useAsync<Action[]>(() =>
    tapi.get<Action[]>('/actions'),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Action | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <OfflineBlock error={error ?? 'No data'} />;
  if (data.length === 0)
    return (
      <div className="empty">
        <h3>No actions configured</h3>
        <p>Ingest an API spec in the setup wizard to populate actions.</p>
      </div>
    );

  const actions = data;

  function patchLocal(id: string, patch: Partial<Action>) {
    setData((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, ...patch } : a)) : prev));
  }

  async function toggleExposed(a: Action) {
    setBusyId(a.id);
    const next = !a.exposed;
    patchLocal(a.id, { exposed: next });
    try {
      await tapi.patch(`/actions/${a.id}`, { exposed: next });
    } catch (err) {
      patchLocal(a.id, { exposed: a.exposed });
      alert(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function changeTier(a: Action, tier: number) {
    setBusyId(a.id);
    const prev = a.tier;
    patchLocal(a.id, { tier });
    try {
      await tapi.patch(`/actions/${a.id}`, { tier });
    } catch (err) {
      patchLocal(a.id, { tier: prev });
      alert(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function bulk(exposed: boolean) {
    setBulkBusy(true);
    const keys = [...selected];
    try {
      await tapi.post('/actions/bulk-expose', { keys, exposed });
      setSelected(new Set());
      reload();
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="bulkbar">
          <span className="count">{selected.size} selected</span>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => bulk(true)} disabled={bulkBusy}>
            {bulkBusy ? <Spinner /> : 'Expose'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => bulk(false)} disabled={bulkBusy}>
            Hide
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  checked={selected.size === actions.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(actions.map((a) => a.key)) : new Set())
                  }
                />
              </th>
              <th>Action</th>
              <th>Endpoint</th>
              <th>Tier</th>
              <th>Step-up</th>
              <th className="num">Rate / hr</th>
              <th>Exposed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(a.key)}
                    onChange={() => toggleSelect(a.key)}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 500 }}>{a.label}</div>
                  <div className="mono muted" style={{ fontSize: 11.5 }}>
                    {a.key}
                  </div>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                    <MethodBadge method={a.method} />
                    <span className="mono">{a.path}</span>
                  </span>
                </td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <TierBadge tier={a.tier} />
                    <select
                      className="select"
                      style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
                      value={a.tier}
                      disabled={busyId === a.id}
                      onChange={(e) => changeTier(a, Number(e.target.value))}
                    >
                      {TIERS.map((t) => (
                        <option key={t.v} value={t.v}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td>
                  {a.stepUpRequired ? (
                    <span className="badge badge-soft status-warn">required</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="num">{a.rateLimitPerUserPerHour ?? '∞'}</td>
                <td>
                  <ToggleButton
                    on={a.exposed}
                    disabled={busyId === a.id}
                    onClick={() => toggleExposed(a)}
                  />
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDrawer
          action={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            patchLocal(editing.id, patch);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function EditDrawer({
  action,
  onClose,
  onSaved,
}: {
  action: Action;
  onClose: () => void;
  onSaved: (patch: Partial<Action>) => void;
}) {
  const [description, setDescription] = useState(action.description ?? '');
  const [confirmationCopy, setConfirmationCopy] = useState(action.confirmationCopy ?? '');
  const [rateLimit, setRateLimit] = useState(String(action.rateLimitPerUserPerHour ?? 0));
  const [stepUp, setStepUp] = useState(action.stepUpRequired);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Test (Tier 0 only)
  const [testArgs, setTestArgs] = useState('{}');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMsg(null);
    const patch = {
      description,
      confirmationCopy,
      rateLimitPerUserPerHour: Number(rateLimit) || 0,
      stepUpRequired: stepUp,
    };
    try {
      await tapi.patch(`/actions/${action.id}`, patch);
      onSaved(patch);
    } catch (err) {
      setMsg({ kind: 'err', text: errMessage(err) });
      setBusy(false);
    }
  }

  async function runTest() {
    setTestBusy(true);
    setTestResult(null);
    let args: unknown = {};
    try {
      args = testArgs.trim() ? JSON.parse(testArgs) : {};
    } catch {
      setTestResult('Invalid JSON in args.');
      setTestBusy(false);
      return;
    }
    try {
      const res = await tapi.post(`/actions/${action.id}/test`, { args });
      setTestResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setTestResult(errMessage(err));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <Drawer
      title={action.label}
      onClose={onClose}
      footer={
        <div className="btn-row">
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? <Spinner /> : 'Save changes'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {msg && <Toast kind={msg.kind}>{msg.text}</Toast>}
        </div>
      }
    >
      <div className="mono muted" style={{ fontSize: 12, marginBottom: 18 }}>
        {action.method} {action.path} · {action.key}
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Confirmation copy</label>
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={confirmationCopy}
          placeholder="Shown to the user before this action runs"
          onChange={(e) => setConfirmationCopy(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Rate limit (per user / hour)</label>
        <input
          className="input"
          type="number"
          min={0}
          value={rateLimit}
          onChange={(e) => setRateLimit(e.target.value)}
        />
      </div>
      <div className="field">
        <label style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <ToggleButton on={stepUp} onClick={() => setStepUp((s) => !s)} />
          Step-up authentication required
        </label>
      </div>

      <div className="section" style={{ marginTop: 24 }}>
        <h3>Test call</h3>
        {action.tier === 0 ? (
          <>
            <div className="field">
              <label>Args (JSON)</label>
              <textarea
                className="textarea mono"
                style={{ minHeight: 70 }}
                value={testArgs}
                onChange={(e) => setTestArgs(e.target.value)}
              />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={runTest} disabled={testBusy}>
              {testBusy ? <Spinner /> : 'Run test'}
            </button>
            {testResult && (
              <pre className="codeblock" style={{ marginTop: 12 }}>
                {testResult}
              </pre>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 12.5 }}>
            Only Tier 0 (read) actions can be test-called.
          </p>
        )}
      </div>
    </Drawer>
  );
}
