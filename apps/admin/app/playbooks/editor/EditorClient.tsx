'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { tapi } from '../../lib/client';
import { TierBadge } from '../../components/ui';
import {
  Spinner,
  Toast,
  ToggleButton,
  useAsync,
  OfflineBlock,
  LoadingBlock,
  errMessage,
} from '../../components/client-ui';

// ---- Types (mirrors the flattened /playbook read shape) ----

type StateRead = {
  key: string;
  label: string;
  description: string;
  openingBehavior: string;
  allowedActions: string[];
  requireConfirmationForTier: number | string;
};
type TriggerRead = { id: string; label: string; enabled: boolean };
type FallbackRead = { order: number; strategy: string; config: unknown };
type PlaybookRead = {
  id: string;
  version: string | number;
  status: string;
  defaultState: string;
  states: StateRead[];
  triggers: TriggerRead[];
  fallbackLadder: FallbackRead[];
};

type ActionRead = { key: string; label: string; tier: number };

// ---- Editable working model ----

type StateEdit = {
  key: string;
  label: string;
  description: string;
  persona: string;
  toneGuidelines: string[];
  openingBehavior: string;
  allowedActionKeys: string[];
  requireConfirmationForTier: number;
};

const OPENING_BEHAVIORS = ['full_intro', 'brief_greeting', 'skip_to_intent', 'retention_mode'];
const FALLBACK_STRATEGIES = ['typo_correction', 'slot_reprompt', 'rephrase', 'offer_options', 'escalate'];
const TIER_COLORS = ['var(--tier-0)', 'var(--tier-1)', 'var(--tier-2)', 'var(--tier-3)'];

// A node's accent color reflects its confirmation tier.
function nodeColor(tier: number): string {
  return TIER_COLORS[Math.max(0, Math.min(3, tier))];
}

export default function EditorClient() {
  const { data, error, loading } = useAsync<PlaybookRead | null>(() =>
    tapi.get<PlaybookRead | null>('/playbook'),
  );
  const actions = useAsync<ActionRead[]>(() => tapi.get<ActionRead[]>('/actions'));

  if (loading || actions.loading) return <LoadingBlock />;
  if (error) return <OfflineBlock error={error} />;
  if (!data)
    return (
      <div className="empty">
        <h3>No active playbook</h3>
        <p>Create one in the setup wizard first.</p>
      </div>
    );

  return <Editor pb={data} actions={actions.data ?? []} />;
}

function Editor({ pb, actions }: { pb: PlaybookRead; actions: ActionRead[] }) {
  const [states, setStates] = useState<StateEdit[]>(() =>
    pb.states.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      persona: '',
      toneGuidelines: [],
      openingBehavior: OPENING_BEHAVIORS.includes(String(s.openingBehavior))
        ? String(s.openingBehavior)
        : 'brief_greeting',
      allowedActionKeys: s.allowedActions ?? [],
      requireConfirmationForTier: Number(s.requireConfirmationForTier) || 0,
    })),
  );
  const [triggers, setTriggers] = useState(
    pb.triggers.map((t) => ({ ...t })),
  );
  const [ladder, setLadder] = useState(
    [...pb.fallbackLadder]
      .sort((a, b) => a.order - b.order)
      .map((f) => {
        const cfg = (f.config ?? {}) as { maxAttempts?: number; messageTemplate?: string };
        return {
          order: f.order,
          strategy: String(f.strategy),
          maxAttempts: cfg.maxAttempts ?? 1,
          messageTemplate: cfg.messageTemplate ?? '',
        };
      }),
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(states[0]?.key ?? null);
  const [defaultState] = useState(pb.defaultState);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const selected = states.find((s) => s.key === selectedKey) ?? null;

  function updateState(key: string, patch: Partial<StateEdit>) {
    setStates((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function save() {
    setSaving(true);
    setMsg(null);

    const lifecycle = {
      defaultState,
      states: states.map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        inferenceHints: [],
        behavior: {
          persona: s.persona,
          toneGuidelines: s.toneGuidelines,
          openingBehavior: s.openingBehavior,
          allowedActionKeys: s.allowedActionKeys,
          kbScopeIds: [],
          skillPacks: [],
          confidenceFloor: 0.6,
          requireConfirmationForTier: s.requireConfirmationForTier,
        },
      })),
    };

    const fallbackLadder = ladder.map((f, i) => ({
      order: i + 1,
      strategy: f.strategy,
      config: { maxAttempts: f.maxAttempts, messageTemplate: f.messageTemplate },
    }));

    // Each trigger is reconstructed as a valid PlaybookTrigger. The enable flag
    // is the field surfaced here; structurally-complete triggers are authored in
    // the trigger editor below.
    const triggerBodies = triggers.map((t) => ({
      id: t.id,
      label: t.label,
      enabled: t.enabled,
      event: (t as Trigger).event ?? { type: 'message_received' },
      condition: (t as Trigger).condition ?? { type: 'state_is', state: defaultState },
      action: (t as Trigger).action ?? { type: 'transition_state', targetState: defaultState },
    }));

    try {
      await tapi.put(`/playbooks/${pb.id}`, {
        lifecycle,
        triggers: triggerBodies,
        fallbackLadder,
      });
      setMsg({ kind: 'ok', text: 'Playbook saved.' });
    } catch (e) {
      setMsg({ kind: 'err', text: errMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="editor-layout">
        <div>
          <StateGraph
            states={states}
            defaultState={defaultState}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />

          <TriggerEditor
            triggers={triggers}
            setTriggers={setTriggers}
            states={states}
            actions={actions}
            defaultState={defaultState}
          />

          <FallbackEditor ladder={ladder} setLadder={setLadder} />
        </div>

        <div>
          {selected ? (
            <StateInspector
              state={selected}
              actions={actions}
              isDefault={selected.key === defaultState}
              onChange={(patch) => updateState(selected.key, patch)}
            />
          ) : (
            <div className="inspector">
              <p className="muted">Select a state to edit its behavior.</p>
            </div>
          )}
        </div>
      </div>

      <div className="sticky-actionbar">
        <Link className="link" href="/playbooks">
          ← Back to playbooks
        </Link>
        <span className="spacer" style={{ flex: 1 }} />
        {msg && <Toast kind={msg.kind}>{msg.text}</Toast>}
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? <Spinner /> : 'Save playbook'}
        </button>
      </div>
    </>
  );
}

// ---- Graph ----

function StateGraph({
  states,
  defaultState,
  selectedKey,
  onSelect,
}: {
  states: StateEdit[];
  defaultState: string;
  selectedKey: string | null;
  onSelect: (k: string) => void;
}) {
  // A clean static 2-column flow with SVG connectors between sequential nodes.
  const cols = 2;
  const positions = useMemo(() => {
    return states.map((s, i) => ({
      key: s.key,
      row: Math.floor(i / cols),
      col: i % cols,
    }));
  }, [states]);

  return (
    <div className="graph-canvas">
      <svg className="graph-svg" preserveAspectRatio="none">
        {positions.slice(1).map((p, idx) => {
          // Connect each node to the previous one as the transition flow.
          const prev = positions[idx];
          const x1 = `${prev.col * 50 + 25}%`;
          const y1 = `${prev.row * 150 + 90}px`;
          const x2 = `${p.col * 50 + 25}%`;
          const y2 = `${p.row * 150 + 40}px`;
          return (
            <line
              key={p.key}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(10,10,10,0.18)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          );
        })}
      </svg>
      <div className="node-grid">
        {states.map((s) => (
          <div
            key={s.key}
            className={`node ${selectedKey === s.key ? 'selected' : ''}`}
            style={{ borderLeftColor: nodeColor(s.requireConfirmationForTier) }}
            onClick={() => onSelect(s.key)}
          >
            <div className="node-label">{s.label}</div>
            <div className="node-key">{s.key}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <TierBadge tier={s.requireConfirmationForTier} />
              <span className="muted" style={{ fontSize: 11 }}>
                {s.allowedActionKeys.length} actions
              </span>
            </div>
            {s.key === defaultState && <div className="node-default">default</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- State inspector ----

function StateInspector({
  state,
  actions,
  isDefault,
  onChange,
}: {
  state: StateEdit;
  actions: ActionRead[];
  isDefault: boolean;
  onChange: (patch: Partial<StateEdit>) => void;
}) {
  const allowsAll = state.allowedActionKeys.includes('*');

  function toggleAction(key: string) {
    if (allowsAll) {
      onChange({ allowedActionKeys: [key] });
      return;
    }
    const has = state.allowedActionKeys.includes(key);
    onChange({
      allowedActionKeys: has
        ? state.allowedActionKeys.filter((k) => k !== key)
        : [...state.allowedActionKeys, key],
    });
  }

  return (
    <div className="inspector">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{state.label}</h3>
        {isDefault && <span className="badge badge-soft status-ok">default</span>}
      </div>
      <div className="mono muted" style={{ fontSize: 11.5, marginBottom: 18 }}>
        {state.key}
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={state.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className="field">
        <label>Persona</label>
        <textarea
          className="textarea"
          value={state.persona}
          placeholder="How the assistant should present itself in this state…"
          onChange={(e) => onChange({ persona: e.target.value })}
        />
        {!state.persona.trim() && (
          <span className="hint status-warn">
            A persona is required to pass preflight. Saving overwrites the stored persona for this state.
          </span>
        )}
      </div>

      <div className="field">
        <label>Tone guidelines</label>
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={state.toneGuidelines.join('\n')}
          placeholder="One guideline per line"
          onChange={(e) =>
            onChange({ toneGuidelines: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })
          }
        />
        <span className="hint">One per line.</span>
      </div>

      <div className="field">
        <label>Opening behavior</label>
        <select
          className="select"
          value={state.openingBehavior}
          onChange={(e) => onChange({ openingBehavior: e.target.value })}
        >
          {OPENING_BEHAVIORS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Require confirmation for tier</label>
        <select
          className="select"
          value={state.requireConfirmationForTier}
          onChange={(e) => onChange({ requireConfirmationForTier: Number(e.target.value) })}
        >
          {[0, 1, 2, 3].map((t) => (
            <option key={t} value={t}>
              T{t} and above
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Allowed actions</label>
        <div style={{ marginBottom: 8 }}>
          <button
            className={`ms-chip ${allowsAll ? 'on' : ''}`}
            onClick={() => onChange({ allowedActionKeys: allowsAll ? [] : ['*'] })}
          >
            * all actions
          </button>
        </div>
        <div className="multiselect">
          {actions.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              No actions available.
            </span>
          ) : (
            actions.map((a) => (
              <button
                key={a.key}
                className={`ms-chip ${state.allowedActionKeys.includes(a.key) ? 'on' : ''}`}
                onClick={() => toggleAction(a.key)}
                title={a.label}
              >
                {a.key}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Trigger editor ----

type TriggerEvent = { type: string; [k: string]: unknown };
type Trigger = {
  id: string;
  label: string;
  enabled: boolean;
  event?: TriggerEvent;
  condition?: { type: string; [k: string]: unknown };
  action?: { type: string; [k: string]: unknown };
};

function summarize(t: Trigger): React.ReactNode {
  const ev = t.event?.type ?? 'message_received';
  const cond = t.condition?.type ?? 'state_is';
  const act = t.action?.type ?? 'transition_state';
  const target = (t.action?.targetState as string) ?? '';
  return (
    <>
      When <b>{ev.replace(/_/g, ' ')}</b>
      {cond && cond !== 'always' ? (
        <> and <b>{cond.replace(/_/g, ' ')}</b></>
      ) : null}
      , <b>{act.replace(/_/g, ' ')}</b>
      {target ? <> → <b>{target}</b></> : null}.
    </>
  );
}

function TriggerEditor({
  triggers,
  setTriggers,
  states,
  actions,
  defaultState,
}: {
  triggers: Trigger[];
  setTriggers: React.Dispatch<React.SetStateAction<Trigger[]>>;
  states: StateEdit[];
  actions: ActionRead[];
  defaultState: string;
}) {
  function update(id: string, patch: Partial<Trigger>) {
    setTriggers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTrigger() {
    setTriggers((prev) => [
      ...prev,
      {
        id: `trg_${Math.random().toString(36).slice(2, 9)}`,
        label: 'New trigger',
        enabled: true,
        event: { type: 'message_received' },
        condition: { type: 'message_contains', phrases: ['help'], matchType: 'any' },
        action: { type: 'transition_state', targetState: states[0]?.key ?? defaultState },
      },
    ]);
  }

  function remove(id: string) {
    setTriggers((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Triggers</h3>
        <button className="btn btn-ghost btn-sm" onClick={addTrigger}>
          Add trigger
        </button>
      </div>
      <div style={{ marginTop: 14 }}>
        {triggers.length === 0 && <p className="muted">No triggers defined.</p>}
        {triggers.map((t) => (
          <div className="trigger-row" key={t.id}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
              <ToggleButton on={t.enabled} onClick={() => update(t.id, { enabled: !t.enabled })} />
              <input
                className="input"
                style={{ flex: 1 }}
                value={t.label}
                onChange={(e) => update(t.id, { label: e.target.value })}
              />
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(t.id)}>
                Remove
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <select
                className="select"
                value={t.event?.type ?? 'message_received'}
                onChange={(e) => update(t.id, { event: { type: e.target.value } })}
              >
                <option value="message_received">message received</option>
                <option value="session_started">session started</option>
                <option value="escalation_requested">escalation requested</option>
                <option value="action_succeeded">action succeeded</option>
                <option value="action_failed">action failed</option>
              </select>
              <select
                className="select"
                value={t.condition?.type ?? 'state_is'}
                onChange={(e) => {
                  const type = e.target.value;
                  const condition =
                    type === 'message_contains'
                      ? { type, phrases: ['help'], matchType: 'any' }
                      : type === 'consecutive_failures'
                        ? { type, count: 2 }
                        : { type, state: states[0]?.key ?? defaultState };
                  update(t.id, { condition });
                }}
              >
                <option value="state_is">state is</option>
                <option value="message_contains">message contains</option>
                <option value="consecutive_failures">consecutive failures</option>
              </select>
              <select
                className="select"
                value={t.action?.type ?? 'transition_state'}
                onChange={(e) => {
                  const type = e.target.value;
                  const action =
                    type === 'transition_state'
                      ? { type, targetState: states[0]?.key ?? defaultState }
                      : type === 'escalate_to_human'
                        ? { type, reason: 'requested', priority: 'normal' }
                        : { type, actionKey: actions[0]?.key ?? '' };
                  update(t.id, { action });
                }}
              >
                <option value="transition_state">transition state</option>
                <option value="escalate_to_human">escalate to human</option>
                <option value="invoke_action">invoke action</option>
              </select>
            </div>
            {t.action?.type === 'transition_state' && (
              <div className="field" style={{ marginBottom: 10 }}>
                <span className="field-label">Target state</span>
                <select
                  className="select"
                  value={(t.action.targetState as string) ?? ''}
                  onChange={(e) =>
                    update(t.id, { action: { type: 'transition_state', targetState: e.target.value } })
                  }
                >
                  {states.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="summary">{summarize(t)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Fallback ladder editor ----

type LadderRow = { order: number; strategy: string; maxAttempts: number; messageTemplate: string };

function FallbackEditor({
  ladder,
  setLadder,
}: {
  ladder: LadderRow[];
  setLadder: React.Dispatch<React.SetStateAction<LadderRow[]>>;
}) {
  function update(i: number, patch: Partial<LadderRow>) {
    setLadder((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function move(i: number, dir: -1 | 1) {
    setLadder((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function add() {
    setLadder((prev) => [
      ...prev,
      { order: prev.length + 1, strategy: 'rephrase', maxAttempts: 1, messageTemplate: '' },
    ]);
  }
  function remove(i: number) {
    setLadder((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Fallback ladder</h3>
        <button className="btn btn-ghost btn-sm" onClick={add}>
          Add step
        </button>
      </div>
      <div style={{ marginTop: 14 }}>
        {ladder.length === 0 && <p className="muted">No fallback steps.</p>}
        {ladder.map((r, i) => (
          <div className="ladder-row" key={i}>
            <span className="ord">{i + 1}</span>
            <select
              className="select"
              style={{ width: 160 }}
              value={r.strategy}
              onChange={(e) => update(i, { strategy: e.target.value })}
            >
              {FALLBACK_STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              min={1}
              value={r.maxAttempts}
              onChange={(e) => update(i, { maxAttempts: Number(e.target.value) || 1 })}
              title="max attempts"
            />
            <input
              className="input"
              style={{ flex: 1, minWidth: 120 }}
              value={r.messageTemplate}
              placeholder="message template"
              onChange={(e) => update(i, { messageTemplate: e.target.value })}
            />
            <div className="btn-row">
              <button className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} disabled={i === 0}>
                ↑
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => move(i, 1)}
                disabled={i === ladder.length - 1}
              >
                ↓
              </button>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(i)}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
