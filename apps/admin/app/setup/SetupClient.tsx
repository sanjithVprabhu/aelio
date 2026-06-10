'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { tapi } from '../lib/client';
import { TierBadge, StatusBadge, MethodBadge } from '../components/ui';
import { Spinner, ToggleButton, Toast, errMessage } from '../components/client-ui';

// Wizard step keys mirror the API's OnboardingStep enum where applicable.
const STEPS = [
  { key: 'connect_api', title: 'Connect API', lede: 'Paste an OpenAPI spec to derive the assistant’s capabilities.' },
  { key: 'review_actions', title: 'Review actions', lede: 'Decide which actions the assistant may expose.' },
  { key: 'connect_channel', title: 'Channels', lede: 'Where the assistant will talk to customers.' },
  { key: 'review_playbook', title: 'Review playbook', lede: 'Confirm the conversation lifecycle.' },
  { key: 'go_live', title: 'Go live', lede: 'Run the readiness checklist and launch.' },
] as const;

export default function SetupClient() {
  const [step, setStep] = useState(0);

  // persist step on change
  useEffect(() => {
    tapi.post('/onboarding/state', { currentStep: STEPS[step].key }).catch(() => {});
  }, [step]);

  // restore previously saved step on mount
  useEffect(() => {
    tapi
      .get<{ currentStep?: string } | null>('/onboarding')
      .then((s) => {
        if (s?.currentStep) {
          const idx = STEPS.findIndex((x) => x.key === s.currentStep);
          if (idx >= 0) setStep(idx);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = STEPS[step];

  return (
    <div className="wizard-shell">
      <div className="wizard-head">
        <div className="wordmark" style={{ color: 'var(--black)' }}>
          Aelio.
        </div>
        <div className="progress-dots">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`dotstep ${i < step ? 'done' : i === step ? 'current' : ''}`}
              title={s.title}
            />
          ))}
        </div>
        <Link className="link" href="/">
          Exit
        </Link>
      </div>

      <div className="wizard-card">
        <div className="muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Step {step + 1} of {STEPS.length}
        </div>
        <h2>{cur.title}</h2>
        <p className="lede">{cur.lede}</p>

        {step === 0 && <ConnectApi />}
        {step === 1 && <ReviewActions />}
        {step === 2 && <Channels />}
        {step === 3 && <ReviewPlaybook />}
        {step === 4 && <GoLive />}

        <div className="wizard-nav">
          <button
            className="btn btn-ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Continue
            </button>
          ) : (
            <Link className="btn" href="/">
              Finish
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

const SAMPLE_SPEC = `{
  "openapi": "3.0.0",
  "info": { "title": "Demo API", "version": "1.0.0" },
  "paths": {
    "/orders/{id}": { "get": { "operationId": "getOrder", "summary": "Get order" } },
    "/orders/{id}/cancel": { "post": { "operationId": "cancelOrder", "summary": "Cancel order" } }
  }
}`;

function ConnectApi() {
  const [raw, setRaw] = useState(SAMPLE_SPEC);
  const [baseUrl, setBaseUrl] = useState('');
  const [exposeAll, setExposeAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    format: string;
    actionCount: number;
    warnings: string[];
    actions: { key: string; tier: number }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ingest() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await tapi.post<typeof result>('/specs', { raw, baseUrl: baseUrl || undefined, exposeAll });
      setResult(res);
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="field">
        <label>OpenAPI spec (JSON)</label>
        <textarea
          className="textarea mono"
          style={{ minHeight: 160 }}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Base URL (optional)</label>
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" />
      </div>
      <div className="field">
        <label style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          <ToggleButton on={exposeAll} onClick={() => setExposeAll((v) => !v)} />
          Expose all parsed actions immediately
        </label>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={ingest} disabled={busy || !raw.trim()}>
          {busy ? <Spinner /> : 'Parse spec'}
        </button>
        {err && <Toast kind="err">{err}</Toast>}
      </div>

      {result && (
        <div style={{ marginTop: 18 }}>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <span className="badge badge-soft">{result.format}</span>
            <span className="badge badge-soft">{result.actionCount} actions</span>
            {result.warnings.length > 0 && (
              <span className="badge badge-soft status-warn">{result.warnings.length} warnings</span>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Suggested tier</th>
                </tr>
              </thead>
              <tbody>
                {result.actions.map((a) => (
                  <tr key={a.key}>
                    <td className="mono">{a.key}</td>
                    <td>
                      <TierBadge tier={a.tier} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.warnings.length > 0 && (
            <ul className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type Action = {
  id: string;
  key: string;
  label: string;
  method: string;
  path: string;
  tier: number;
  exposed: boolean;
};

function ReviewActions() {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  async function load() {
    try {
      setActions(await tapi.get<Action[]>('/actions'));
    } catch (e) {
      setErr(errMessage(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(a: Action) {
    setBusy(true);
    try {
      await tapi.patch(`/actions/${a.id}`, { exposed: !a.exposed });
      setActions((prev) => (prev ? prev.map((x) => (x.id === a.id ? { ...x, exposed: !x.exposed } : x)) : prev));
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function bulk(exposed: boolean) {
    if (!actions) return;
    setBulkBusy(true);
    try {
      await tapi.post('/actions/bulk-expose', { keys: actions.map((a) => a.key), exposed });
      await load();
    } catch (e) {
      alert(errMessage(e));
    } finally {
      setBulkBusy(false);
    }
  }

  if (err) return <div className="panel"><Toast kind="err">{err}</Toast></div>;
  if (!actions) return <div className="panel"><Spinner /></div>;
  if (actions.length === 0)
    return (
      <div className="panel">
        <p className="muted">No actions yet. Parse a spec in the previous step.</p>
      </div>
    );

  return (
    <div className="panel">
      <div className="btn-row" style={{ marginBottom: 12 }}>
        <button className="btn btn-sm" onClick={() => bulk(true)} disabled={bulkBusy}>
          Expose all
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => bulk(false)} disabled={bulkBusy}>
          Hide all
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Endpoint</th>
              <th>Tier</th>
              <th>Exposed</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.key}</td>
                <td>
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline' }}>
                    <MethodBadge method={a.method} />
                    <span className="mono">{a.path}</span>
                  </span>
                </td>
                <td>
                  <TierBadge tier={a.tier} />
                </td>
                <td>
                  <ToggleButton on={a.exposed} disabled={busy} onClick={() => toggle(a)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Channel = { id: string; type: string; status: string; inboundEnabled: boolean; outboundEnabled: boolean };

function Channels() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    tapi
      .get<Channel[]>('/channels')
      .then(setChannels)
      .catch((e) => setErr(errMessage(e)));
  }, []);

  if (err) return <div className="panel"><Toast kind="err">{err}</Toast></div>;
  if (!channels) return <div className="panel"><Spinner /></div>;

  return (
    <div className="panel">
      {channels.length === 0 ? (
        <p className="muted">No channels connected yet.</p>
      ) : (
        <div className="cards-grid">
          {channels.map((c) => (
            <div
              key={c.id}
              style={{ border: '1px solid var(--hairline)', borderRadius: 10, padding: 16 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ textTransform: 'capitalize' }}>{c.type}</strong>
                <StatusBadge status={c.status} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                inbound {c.inboundEnabled ? 'on' : 'off'} · outbound {c.outboundEnabled ? 'on' : 'off'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type PlaybookRead = {
  version: string | number;
  status: string;
  defaultState: string;
  states: { key: string; label: string; description: string }[];
} | null;

function ReviewPlaybook() {
  const [pb, setPb] = useState<PlaybookRead | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    tapi
      .get<PlaybookRead>('/playbook')
      .then(setPb)
      .catch((e) => setErr(errMessage(e)));
  }, []);

  if (err) return <div className="panel"><Toast kind="err">{err}</Toast></div>;
  if (pb === undefined) return <div className="panel"><Spinner /></div>;
  if (!pb)
    return (
      <div className="panel">
        <p className="muted">No active playbook configured.</p>
      </div>
    );

  return (
    <div className="panel">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <span className="chip">v{pb.version}</span>
        <StatusBadge status={pb.status} />
        <span className="muted" style={{ fontSize: 12.5 }}>
          default · <span className="mono">{pb.defaultState}</span>
        </span>
      </div>
      <div className="cards-grid">
        {pb.states.map((s) => (
          <div key={s.key} style={{ border: '1px solid var(--hairline)', borderRadius: 10, padding: 16 }}>
            <strong>{s.label}</strong>
            <div className="mono muted" style={{ fontSize: 11, margin: '2px 0 8px' }}>
              {s.key}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-70)' }}>{s.description}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <Link className="link" href="/playbooks/editor">
          Open the visual editor →
        </Link>
      </div>
    </div>
  );
}

function GoLive() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ready: boolean;
    checklist: { label: string; passed: boolean; blocker: boolean }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      setResult(await tapi.post('/onboarding/go-live'));
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      {!result && (
        <>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Run the readiness checklist. All blocking checks must pass before the assistant goes live.
          </p>
          <button className="btn" onClick={run} disabled={busy}>
            {busy ? <Spinner /> : 'Run readiness check'}
          </button>
          {err && <div style={{ marginTop: 12 }}><Toast kind="err">{err}</Toast></div>}
        </>
      )}

      {result && (
        <>
          {result.ready ? (
            <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
              <div
                className="check-icon"
                style={{ background: 'var(--tier-0)', width: 44, height: 44, fontSize: 22, margin: '0 auto 12px' }}
              >
                ✓
              </div>
              <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>You&apos;re live</h3>
              <p className="muted" style={{ fontSize: 13 }}>
                The assistant is active for tenant acme.
              </p>
            </div>
          ) : (
            <p className="status-bad" style={{ fontWeight: 600, marginBottom: 12 }}>
              Some blocking checks still need attention.
            </p>
          )}

          <div>
            {result.checklist.map((c, i) => (
              <div key={i} className="checklist-item">
                <span
                  className="check-icon"
                  style={{
                    background: c.passed ? 'var(--tier-0)' : c.blocker ? 'var(--tier-3)' : 'var(--tier-2)',
                  }}
                >
                  {c.passed ? '✓' : '!'}
                </span>
                <span style={{ fontSize: 13.5 }}>{c.label}</span>
                {!c.blocker && (
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    (optional)
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={run} disabled={busy}>
              {busy ? <Spinner /> : 'Re-run'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
