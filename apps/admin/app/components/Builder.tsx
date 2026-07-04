'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps, type NodeChange, type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, getToken } from '../lib/api';
import { I } from '../lib/icons';
import { Rail } from './Rail';
import LiveChat from './LiveChat';
import { Action, Playbook, PlaybookState, Workflow, buildSystemPrompt, stateColor } from '../lib/types';

type NodeKind = 'trigger' | 'action' | 'fallback';

const KIND = {
  trigger: { label: 'TRIGGER', color: '#B8840E', bg: 'rgba(184,132,14,.07)', Icon: I.zap },
  action: { label: 'ACTION', color: '#3562C8', bg: 'rgba(53,98,200,.07)', Icon: I.arrow },
  fallback: { label: 'FALLBACK', color: '#C43838', bg: 'rgba(196,56,56,.07)', Icon: I.warning },
} as const;

const EVENTS = ['message_received', 'action_succeeded', 'action_failed', 'state_entered', 'session_started'];
const COND_TYPES = ['message_contains', 'message_intent', 'state_is', 'consecutive_failures', 'always'];
const STRATEGIES = ['typo_correction', 'slot_reprompt', 'rephrase', 'offer_options', 'escalate'];
const ERROR_TYPES = [
  { key: 'typo', label: 'Spelling / Typo', strategy: 'typo_correction', message: "I think there might be a typo — could you double-check that?" },
  { key: 'misunderstood', label: "Didn't Understand", strategy: 'rephrase', message: "I didn't quite catch that. Could you rephrase?" },
  { key: 'auth', label: 'Auth / Permission Error', strategy: 'escalate', message: "I'm unable to access that right now. Let me connect you with the team." },
  { key: 'general', label: 'General / Unknown', strategy: 'offer_options', message: "Here are some things I can help with." },
] as const;
const OPENING = ['full_intro', 'brief_greeting', 'skip_to_intent', 'retention_mode'];

/* ── Workflow palette + layout ── */
const WORKFLOW_COLORS = ['#3562C8', '#3C9B6A', '#B8840E', '#7C51D8', '#C4612A', '#1A8FA6'];
const WORKFLOW_X_BASE = 40;
const WORKFLOW_Y_BASE = 150;
const WORKFLOW_Y_GAP = 220;
const WORKFLOW_X_STEP = 230;

function workflowColor(idx: number): string {
  return WORKFLOW_COLORS[idx % WORKFLOW_COLORS.length];
}
function positionForWorkflow(idx: number): { x: number; y: number } {
  return { x: WORKFLOW_X_BASE, y: WORKFLOW_Y_BASE + idx * WORKFLOW_Y_GAP };
}
function layoutWorkflow(workflow: Workflow, idx: number): Workflow {
  const color = workflowColor(idx);
  const baseY = WORKFLOW_Y_BASE + idx * WORKFLOW_Y_GAP;
  return {
    ...workflow,
    nodes: workflow.nodes.map((n, j) => ({
      ...n,
      position: { x: WORKFLOW_X_BASE + j * WORKFLOW_X_STEP, y: baseY },
      data: { ...(n.data || {}), workflowId: workflow.id, workflowColor: color },
    })),
  };
}
function layoutWorkflows(workflows: Workflow[]): Workflow[] {
  return workflows.map((w, i) => layoutWorkflow(w, i));
}

/* ── Custom nodes ── */
function NodeShell({ kind, title, sub, fields, selected, workflowColor }: { kind: NodeKind; title: string; sub: string; fields: { l: string; v: string }[]; selected?: boolean; workflowColor?: string }) {
  const k = KIND[kind];
  return (
    <div style={{ width: 210, background: selected ? k.bg : '#fff', border: `1px solid ${selected ? k.color + '66' : 'rgba(10,10,10,.12)'}`, borderTop: `3px solid ${k.color}`, borderLeft: workflowColor ? `3px solid ${workflowColor}` : undefined, borderRadius: 10, padding: '9px 11px 9px 9px', boxShadow: selected ? `0 0 0 3px ${k.color}1f, 0 6px 20px rgba(0,0,0,.1)` : '0 1px 5px rgba(0,0,0,.07)' }}>
      <Handle type="target" position={Position.Left} style={{ width: 9, height: 9, background: '#fff', border: `1.5px solid ${k.color}` }} />
      <Handle type="source" position={Position.Right} style={{ width: 9, height: 9, background: k.color, border: `1.5px solid ${k.color}` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
        <span style={{ display: 'flex', color: k.color }}><k.Icon /></span>
        <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.13em', color: k.color, textTransform: 'uppercase' }}>{k.label}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '-0.018em', color: '#0A0A0A', lineHeight: 1.2, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      <div style={{ fontSize: 9, color: 'rgba(10,10,10,.4)', fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: fields.length ? 6 : 0 }}>{sub}</div>
      {fields.length > 0 && <div style={{ borderTop: '1px solid rgba(10,10,10,.07)', marginBottom: 6 }} />}
      {fields.map((f, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(10,10,10,.34)', marginBottom: 2 }}>{f.l}</div>
          <div style={{ fontSize: 9.5, color: 'rgba(10,10,10,.66)', background: 'rgba(10,10,10,.035)', border: '1px solid rgba(10,10,10,.07)', borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.v || '—'}</div>
        </div>
      ))}
    </div>
  );
}
function TriggerNode({ data, selected }: NodeProps) {
  const d = data as any;
  const cond = d.condition?.type === 'message_contains' ? (d.condition.phrases || []).join(', ') : d.condition?.type || 'any';
  return <NodeShell kind="trigger" title={d.label || 'Trigger'} sub={d.event?.type || 'event'} selected={selected} workflowColor={d.workflowColor} fields={[{ l: 'When', v: cond }]} />;
}
function ActionNode({ data, selected }: NodeProps) {
  const d = data as any;
  return <NodeShell kind="action" title={d.label || d.actionKey || 'Action'} sub={(d.method || '') + ' ' + (d.path || '')} selected={selected} workflowColor={d.workflowColor} fields={[{ l: 'Tool', v: d.actionKey || '—' }, { l: 'Tier', v: d.tier != null ? 'Tier ' + d.tier : '—' }]} />;
}
function FallbackNode({ data, selected }: NodeProps) {
  const d = data as any;
  return <NodeShell kind="fallback" title={(d.strategy || 'fallback').replace(/_/g, ' ')} sub={'attempts: ' + (d.config?.maxAttempts ?? 1)} selected={selected} workflowColor={d.workflowColor} fields={[{ l: 'Message', v: (d.config?.messageTemplate || '').slice(0, 40) }]} />;
}
const nodeTypes = { trigger: TriggerNode, action: ActionNode, fallback: FallbackNode };

/* ── Build initial workflows for a state ── */
function migrate(state: PlaybookState, actions: Action[], fallbackLadder: any[]): Workflow[] {
  const wfId = 'wf_default';
  if (state.flow && state.flow.nodes?.length) {
    const nodes: Node[] = (state.flow.nodes as any[]).map((n) => ({ ...n, data: { ...(n.data || {}), workflowId: wfId } }));
    const edges: Edge[] = (state.flow.edges as Edge[]).map((e) => ({ ...e }));
    return [{ id: wfId, label: 'Default workflow', nodes, edges }];
  }
  const exposed = actions.filter((a) => a.exposed);
  const allow = state.allowedActions.includes('*') ? exposed : exposed.filter((a) => state.allowedActions.includes(a.key));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let x = 30;
  const tId = 'trigger_entry';
  nodes.push({ id: tId, type: 'trigger', position: { x, y: 150 }, data: { workflowId: wfId, label: 'User message', event: { type: 'message_received' }, condition: { type: 'always' }, synthetic: true } });
  let prev = tId; x += 250;
  allow.slice(0, 4).forEach((a) => {
    const id = 'action_' + a.key;
    nodes.push({ id, type: 'action', position: { x, y: 150 }, data: { workflowId: wfId, actionKey: a.key, label: a.label, tier: a.tier, method: a.method, path: a.path } });
    edges.push({ id: 'e_' + prev + '_' + id, source: prev, target: id, markerEnd: { type: MarkerType.ArrowClosed } });
    prev = id; x += 250;
  });
  (fallbackLadder || []).slice(0, 1).forEach((f) => {
    const id = 'fallback_' + f.order;
    nodes.push({ id, type: 'fallback', position: { x, y: 150 }, data: { workflowId: wfId, strategy: f.strategy, config: f.config } });
    edges.push({ id: 'e_' + prev + '_' + id, source: prev, target: id, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#C43838', strokeDasharray: '5,4' } });
    prev = id;
  });
  return [{ id: wfId, label: 'Default workflow', nodes, edges }];
}

function buildActionNodeDataFromTrigger(action: any, actions: Action[]): any {
  if (!action || !action.type) return { actionKey: '', label: 'Action', tier: 0, method: '', path: '' };
  switch (action.type) {
    case 'invoke_action': {
      const a = actions.find((x) => x.key === action.actionKey);
      return { actionKey: action.actionKey, label: a?.label || action.actionKey, tier: a?.tier ?? 0, method: a?.method ?? '', path: a?.path ?? '' };
    }
    case 'transition_state':
      return { actionKey: '', label: 'Transition → ' + action.targetState, tier: 0, method: '', path: '' };
    case 'escalate_to_human':
      return { actionKey: '', label: 'Escalate: ' + (action.reason || 'human'), tier: 0, method: '', path: '' };
    case 'send_message':
      return { actionKey: '', label: 'Send: ' + action.templateKey, tier: 0, method: '', path: '' };
    case 'set_metadata':
      return { actionKey: '', label: 'Set ' + action.key, tier: 0, method: '', path: '' };
    default:
      return { actionKey: '', label: action.type, tier: 0, method: '', path: '' };
  }
}

function isSyntheticTrigger(node: Node): boolean {
  const d = node.data as any;
  return d?.synthetic === true && d?.label === 'User message';
}

function migrateTriggers(pb: Playbook, actions: Action[]): Workflow[] {
  if (!pb.triggers?.length) return [];
  return pb.triggers.map((trig) => {
    const wfId = 'wf_trig_' + trig.id;
    const tId = 'trigger_' + trig.id;
    const aId = 'action_' + trig.id;
    const tNode: Node = {
      id: tId,
      type: 'trigger',
      position: { x: 30, y: 80 },
      data: { workflowId: wfId, label: trig.label, event: trig.event, condition: trig.condition },
    };
    const aData = buildActionNodeDataFromTrigger(trig.action, actions);
    const aNode: Node = {
      id: aId,
      type: 'action',
      position: { x: 280, y: 80 },
      data: { workflowId: wfId, ...aData },
    };
    const edge: Edge = { id: 'e_' + tId + '_' + aId, source: tId, target: aId, markerEnd: { type: MarkerType.ArrowClosed } };
    return { id: wfId, label: 'Migrated: ' + trig.label, nodes: [tNode, aNode], edges: [edge] };
  });
}

/* ════════════════ Builder ════════════════ */
export default function Builder() {
  const router = useRouter();
  const [pb, setPb] = useState<Playbook | null>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [workflows, setWorkflows] = useState<Record<string, Workflow[]>>({});
  const [selStateKey, setSelStateKey] = useState('');
  const [selWorkflowId, setSelWorkflowId] = useState<string | null>(null);
  const [selNodeId, setSelNodeId] = useState<string | null>(null);
  const [tab, setTab] = useState<'build' | 'prompt' | 'test'>('build');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flash = (m: string) => { setToast(m); const t = setTimeout(() => setToast(null), 2400); timeoutsRef.current.push(t); };

  useEffect(() => { return () => { timeoutsRef.current.forEach(clearTimeout); }; }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !getToken()) { router.replace('/login'); return; }
    Promise.all([api<Playbook>('/playbook'), api<Action[]>('/actions')]).then(([p, a]) => {
      setPb(p); setActions(a);
      const wf: Record<string, Workflow[]> = {};
      const defaultKey = p.defaultState || p.states[0]?.key || '';
      p.states.forEach((s) => { wf[s.key] = layoutWorkflows(migrate(s, a, p.fallbackLadder)); });
      const trigWfs = migrateTriggers(p, a);
      if (trigWfs.length && defaultKey) wf[defaultKey] = layoutWorkflows([...(wf[defaultKey] || []), ...trigWfs]);
      setWorkflows(wf);
      setSelStateKey(defaultKey);
      setSelWorkflowId(wf[defaultKey]?.[0]?.id || null);
      setLoading(false);
    }).catch((e) => { setErr(e?.message || 'Failed to load'); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = workflows[selStateKey] || [];
  const curGraph = useMemo(() => ({ nodes: cur.flatMap((w) => w.nodes), edges: cur.flatMap((w) => w.edges) }), [cur]);
  const selState = pb?.states.find((s) => s.key === selStateKey) || null;
  const selNode = curGraph.nodes.find((n) => n.id === selNodeId) || null;

  useEffect(() => {
    const wfs = workflows[selStateKey] || [];
    if (!wfs.length) { setSelWorkflowId(null); return; }
    if (!wfs.some((w) => w.id === selWorkflowId)) setSelWorkflowId(wfs[0].id);
  }, [selStateKey, workflows]);

  const setWorkflowsFor = useCallback((key: string, fn: (wfs: Workflow[]) => Workflow[]) => {
    setWorkflows((prev) => ({ ...prev, [key]: fn(prev[key] || []) }));
    setDirty(true);
  }, []);

  const onNodesChange = useCallback((ch: NodeChange[]) => setWorkflowsFor(selStateKey, (wfs) => wfs.map((w) => ({ ...w, nodes: applyNodeChanges(ch, w.nodes) }))), [selStateKey, setWorkflowsFor]);
  const onEdgesChange = useCallback((ch: EdgeChange[]) => setWorkflowsFor(selStateKey, (wfs) => wfs.map((w) => ({ ...w, edges: applyEdgeChanges(ch, w.edges) }))), [selStateKey, setWorkflowsFor]);
  const onConnect = useCallback((c: Connection) => setWorkflowsFor(selStateKey, (wfs) => {
    if (!c.source) return wfs;
    const idx = wfs.findIndex((w) => w.nodes.some((n) => n.id === c.source));
    if (idx < 0) return wfs;
    return wfs.map((w, i) => i === idx ? { ...w, edges: addEdge({ ...c, markerEnd: { type: MarkerType.ArrowClosed } }, w.edges) } : w);
  }), [selStateKey, setWorkflowsFor]);

  function addNode(kind: NodeKind) {
    const id = kind + '_' + Math.random().toString(36).slice(2, 7);
    const data: any = kind === 'trigger' ? { label: 'New trigger', event: { type: 'message_received' }, condition: { type: 'message_contains', phrases: ['keyword'], matchType: 'any' } }
      : kind === 'action' ? { actionKey: actions.find((a) => a.exposed)?.key || '', label: actions.find((a) => a.exposed)?.label || 'Pick a tool', tier: actions.find((a) => a.exposed)?.tier ?? 0, method: '', path: '' }
        : { strategy: 'rephrase', config: { maxAttempts: 1, messageTemplate: 'Could you say that another way?' } };
    const wfs = workflows[selStateKey] || [];
    if (!wfs.length) {
      const wfId = 'wf_' + Math.random().toString(36).slice(2, 7);
      const color = workflowColor(0);
      const basePos = positionForWorkflow(0);
      const newNode: Node = {
        id, type: kind,
        position: { x: basePos.x, y: basePos.y },
        data: { ...data, workflowId: wfId, workflowColor: color },
        selected: true,
      };
      setWorkflowsFor(selStateKey, () => [{ id: wfId, label: 'Default workflow', nodes: [newNode], edges: [] }]);
      setSelWorkflowId(wfId);
    } else {
      let targetIdx = wfs.findIndex((w) => w.id === selWorkflowId);
      if (targetIdx < 0) targetIdx = 0;
      const targetWf = wfs[targetIdx];
      const color = workflowColor(targetIdx);
      const basePos = positionForWorkflow(targetIdx);
      const newNode: Node = {
        id, type: kind,
        position: { x: basePos.x + targetWf.nodes.length * WORKFLOW_X_STEP, y: basePos.y },
        data: { ...data, workflowId: targetWf.id, workflowColor: color },
        selected: true,
      };
      setWorkflowsFor(selStateKey, (cur) => cur.map((w, i) => i === targetIdx ? { ...w, nodes: [...w.nodes, newNode] } : w));
      setSelWorkflowId(targetWf.id);
    }
    setSelNodeId(id); setTab('build');
  }
  function updateNode(id: string, patch: any) {
    setWorkflowsFor(selStateKey, (wfs) => wfs.map((w) => {
      if (!w.nodes.some((n) => n.id === id)) return w;
      return { ...w, nodes: w.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) };
    }));
  }
  function deleteNode(id: string) {
    setWorkflowsFor(selStateKey, (wfs) => wfs.map((w) => {
      if (!w.nodes.some((n) => n.id === id)) return w;
      return { ...w, nodes: w.nodes.filter((n) => n.id !== id), edges: w.edges.filter((e) => e.source !== id && e.target !== id) };
    }));
    setSelNodeId(null);
  }

  /* workflow CRUD */
  function addWorkflow(label?: string) {
    const wfs = workflows[selStateKey] || [];
    const wfId = 'wf_' + Math.random().toString(36).slice(2, 7);
    const newLabel = label || ('Workflow ' + (wfs.length + 1));
    setWorkflowsFor(selStateKey, (cur) => [...cur, { id: wfId, label: newLabel, nodes: [], edges: [] }]);
    setSelWorkflowId(wfId);
    setSelNodeId(null);
  }
  function renameWorkflow(id: string, newLabel: string) {
    setWorkflowsFor(selStateKey, (wfs) => wfs.map((w) => w.id === id ? { ...w, label: newLabel } : w));
  }
  function deleteWorkflow(id: string) {
    const wfs = workflows[selStateKey] || [];
    const wf = wfs.find((w) => w.id === id);
    if (!wf) return;
    if (wf.nodes.length > 0) {
      if (!confirm(`Delete workflow "${wf.label}" with ${wf.nodes.length} node${wf.nodes.length === 1 ? '' : 's'}?`)) return;
    }
    setWorkflowsFor(selStateKey, (cur) => {
      const remaining = cur.filter((w) => w.id !== id);
      return remaining.map((w, i) => ({
        ...w,
        nodes: w.nodes.map((n) => ({ ...n, data: { ...(n.data || {}), workflowColor: workflowColor(i) } })),
      }));
    });
    if (selWorkflowId === id) {
      const remaining = wfs.filter((w) => w.id !== id);
      setSelWorkflowId(remaining[0]?.id || null);
    }
  }

  /* state CRUD */
  function addState() {
    let key = 'new_state'; let n = 1;
    while (pb?.states.some((s) => s.key === key)) key = 'new_state_' + n++;
    setPb((p) => p ? { ...p, states: [...p.states, { key, label: 'New State', description: 'Describe this stage', persona: 'You are the assistant for this state.', toneGuidelines: ['Be helpful'], openingBehavior: 'brief_greeting', allowedActions: ['*'], kbScopeIds: [], confidenceFloor: 0.6, requireConfirmationForTier: 1 }] } : p);
    setWorkflows((f) => ({ ...f, [key]: [{ id: 'wf_default', label: 'Default workflow', nodes: [{ id: 'trigger_entry', type: 'trigger', position: { x: 40, y: 150 }, data: { workflowId: 'wf_default', label: 'User message', event: { type: 'message_received' }, condition: { type: 'always' } } }], edges: [] }] }));
    setSelStateKey(key); setSelNodeId(null); setDirty(true); setTab('build');
  }
  function deleteState(key: string) {
    if (!pb) return;
    if (key === pb.defaultState) return flash("Can't delete the default state");
    if (pb.states.length <= 1) return flash('Keep at least one state');
    setPb((p) => p ? { ...p, states: p.states.filter((s) => s.key !== key) } : p);
    setWorkflows((f) => { const c = { ...f }; delete c[key]; return c; });
    const next = pb.states.find((s) => s.key !== key)!.key;
    setSelStateKey(next); setSelNodeId(null); setDirty(true);
  }
  const editState = (patch: Partial<PlaybookState>) => { setPb((p) => p ? { ...p, states: p.states.map((s) => (s.key === selStateKey ? { ...s, ...patch } : s)) } : p); setDirty(true); };

  /* save: flatten workflows per state → triggers (one per trigger node, action from connected action node) + behavior.allowedActionKeys (deduped) + fallbackLadder (deduped, escalate last). Save guard: if ALL states have zero trigger nodes, preserve pb.triggers + pb.fallbackLadder unchanged. */
  async function save() {
    if (!pb) return;
    setSaving(true);
    try {
      let triggersOut: any[] = [];
      const fbSet: { strategy: string; config: any }[] = [];
      let totalTriggerNodes = 0;

      const states = pb.states.map((s) => {
        const wfs = workflows[s.key] || [];
        const g = { nodes: wfs.flatMap((w) => w.nodes), edges: wfs.flatMap((w) => w.edges) };

        // One PlaybookTrigger per trigger node — find the connected action via the first outgoing edge
        g.nodes.filter((n) => n.type === 'trigger').forEach((tNode) => {
          totalTriggerNodes++;
          if (isSyntheticTrigger(tNode)) return; // skip auto-generated synthetic triggers
          const outEdge = g.edges.find((e) => e.source === tNode.id);
          const aNode = outEdge ? g.nodes.find((n) => n.id === outEdge.target) : null;
          const aData = aNode?.data as any;
          let action: any;
          if (aData?.actionKey) action = { type: 'invoke_action', actionKey: aData.actionKey };
          else if (typeof aData?.label === 'string' && aData.label.startsWith('Transition → ')) action = { type: 'transition_state', targetState: aData.label.slice('Transition → '.length) };
          else if (typeof aData?.label === 'string' && aData.label.startsWith('Escalate:')) action = { type: 'escalate_to_human', reason: aData.label.slice('Escalate:'.length).trim() || 'human', priority: 'normal' };
          else action = { type: 'invoke_action', actionKey: aData?.actionKey || '' };
          triggersOut.push({
            id: 'trig_' + Math.random().toString(36).slice(2, 10),
            label: (tNode.data as any).label || 'Trigger',
            enabled: true,
            event: (tNode.data as any).event,
            condition: (tNode.data as any).condition,
            action,
          });
        });

        g.nodes.filter((n) => n.type === 'fallback').forEach((n) => {
          fbSet.push({ strategy: (n.data as any).strategy, config: (n.data as any).config || { maxAttempts: 1, messageTemplate: '' } });
        });

        const actionKeys = g.nodes.filter((n) => n.type === 'action').map((n) => (n.data as any).actionKey).filter(Boolean);
        const allowed = wfs.length === 0 ? [] : Array.from(new Set(actionKeys));

        return {
          key: s.key, label: s.label, description: s.description,
          behavior: {
            persona: s.persona, toneGuidelines: s.toneGuidelines, openingBehavior: s.openingBehavior,
            allowedActionKeys: allowed, kbScopeIds: s.kbScopeIds, skillPacks: [],
            confidenceFloor: s.confidenceFloor, requireConfirmationForTier: s.requireConfirmationForTier,
            flow: { nodes: g.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })), edges: g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) },
          },
        };
      });

      // Dedupe triggers by (event, condition, action) signature — prevents accumulation
      // when the same default "User message" trigger exists across multiple states.
      const triggerSig = (t: any) => JSON.stringify({ e: t.event, c: t.condition, a: t.action });
      const seenSigs = new Set<string>();
      triggersOut = triggersOut.filter((t) => {
        const sig = triggerSig(t);
        if (seenSigs.has(sig)) return false;
        seenSigs.add(sig);
        return true;
      });

      // Save guard: zero workflow trigger nodes across ALL states → preserve existing triggers + ladder unchanged
      let triggersFinal: any[];
      let ladderFinal: any[];
      if (totalTriggerNodes === 0) {
        triggersFinal = pb.triggers;
        ladderFinal = pb.fallbackLadder;
      } else {
        triggersFinal = triggersOut;
        const seen = new Set<string>();
        let ladder = fbSet.filter((f) => (seen.has(f.strategy) ? false : (seen.add(f.strategy), true)))
          .map((f, i) => ({ order: i + 1, strategy: f.strategy, config: f.config }));
        if (!ladder.length) ladder = pb.fallbackLadder;
        else if (!ladder.some((f) => f.strategy === 'escalate')) ladder.push({ order: ladder.length + 1, strategy: 'escalate', config: { maxAttempts: 1, messageTemplate: 'Let me connect you with a teammate.' } });
        else { ladder = ladder.filter((f) => f.strategy !== 'escalate'); ladder.push({ order: ladder.length + 1, strategy: 'escalate', config: { maxAttempts: 1, messageTemplate: 'Let me connect you with a teammate.' } }); }
        ladderFinal = ladder;
      }

      await api(`/playbooks/${pb.id}`, { method: 'PUT', body: { lifecycle: { defaultState: pb.defaultState, states }, triggers: triggersFinal, fallbackLadder: ladderFinal } });
      setDirty(false); flash('Saved ✓');
    } catch (e: any) { flash('Save failed: ' + (e?.message || '')); }
    finally { setSaving(false); }
  }

  if (loading) return <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}><span className="spinner" style={{ width: 26, height: 26 }} /></div>;
  if (err || !pb || !selState) return (
    <div style={{ display: 'flex', height: '100vh' }}><Rail open /><div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Couldn't load the playbook</div><div style={{ fontSize: 13, color: 'var(--ink-45)', marginBottom: 14 }}>{err}</div><button onClick={() => location.reload()} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>Retry</button></div>
    </div></div>
  );

  const allowAll = selState.allowedActions.includes('*');
  const allowedLabels = allowAll ? actions.filter((a) => a.exposed).map((a) => a.label) : actions.filter((a) => a.exposed && selState.allowedActions.includes(a.key)).map((a) => a.label);
  const flowActionLabels = curGraph.nodes.filter((n) => n.type === 'action').map((n) => (n.data as any).label);
  const prompt = buildSystemPrompt(selState, flowActionLabels.length ? flowActionLabels : allowedLabels);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <Rail open={sidebarOpen} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* topbar */}
        <div style={{ height: 52, background: 'var(--white)', borderBottom: '1px solid var(--ink-10)', display: 'flex', alignItems: 'center', padding: '0 14px 0 16px', gap: 10, flexShrink: 0, zIndex: 10 }}>
          <button onClick={() => setSidebarOpen((o) => !o)} style={iconBtn}><I.menu /></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-45)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink)', fontWeight: 600 }}><I.flow /> Playbooks</span>
            <span style={{ color: 'var(--ink-22)' }}>›</span><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{selState.label}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-45)', background: 'var(--ink-05)', borderRadius: 5, padding: '2px 7px', marginLeft: 4 }}>v{pb.version} · {pb.status}</span>
          </div>
          <div style={{ flex: 1 }} />
          {dirty && <span style={{ fontSize: 11.5, color: 'var(--amber)', fontWeight: 600 }}>Unsaved</span>}
          <button onClick={save} disabled={!dirty || saving} style={{ ...ghostBtn, background: dirty ? 'var(--ink-05)' : 'none', color: dirty ? 'var(--ink)' : 'var(--ink-45)', cursor: dirty ? 'pointer' : 'default', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          <button onClick={() => setTab('test')} style={ghostBtn}><I.play /> Test</button>
          <button onClick={() => setPublishOpen(true)} style={{ ...ghostBtn, background: 'var(--ink)', color: '#fff', border: 'none' }}><I.upload /> Publish</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <StatePanel pb={pb} selStateKey={selStateKey} onSelect={(k) => { setSelStateKey(k); setSelNodeId(null); setTab('build'); }} onAdd={addState} onDelete={deleteState} />

          {/* React Flow canvas */}
          <div style={{ flex: 1, position: 'relative', background: 'var(--bg)' }}>
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, display: 'flex', gap: 6, background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 10, padding: 6, boxShadow: '0 2px 12px rgba(0,0,0,.08)', alignItems: 'center', overflowX: 'auto', overflowY: 'hidden' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-45)', padding: '0 6px 0 2px', flexShrink: 0 }}>
                <I.cycle size={11} /> Workflows
              </span>
              {cur.map((wf, i) => (
                <WorkflowChip
                  key={wf.id}
                  wf={wf}
                  idx={i}
                  selected={wf.id === selWorkflowId}
                  onClick={() => { setSelWorkflowId(wf.id); setSelNodeId(null); }}
                  onRename={(newLabel) => renameWorkflow(wf.id, newLabel)}
                  onDelete={() => deleteWorkflow(wf.id)}
                />
              ))}
              <button onClick={() => addWorkflow()} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--ink-45)', background: 'transparent', border: '1px dashed var(--ink-22)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                <I.plus size={11} /> New
              </button>
            </div>
            <div style={{ position: 'absolute', top: 64, left: 12, zIndex: 5, display: 'flex', gap: 8, background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 10, padding: 6, boxShadow: '0 2px 12px rgba(0,0,0,.08)', alignItems: 'center' }}>
              {(['trigger', 'action', 'fallback'] as NodeKind[]).map((kind) => (
                <button key={kind} aria-label={`Add ${kind} node`} onClick={() => addNode(kind)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: KIND[kind].color, background: KIND[kind].bg, border: `1.5px solid ${KIND[kind].color}44`, borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                  <I.plus /> {kind}
                </button>
              ))}
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--ink-10)', margin: '2px 4px' }} />
              <button onClick={() => addWorkflow()} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', background: 'var(--ink-05)', border: '1px solid var(--ink-22)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <I.plus /> New Workflow
              </button>
              <span style={{ alignSelf: 'center', fontSize: 11, color: 'var(--ink-45)', marginLeft: 4 }}>drag a node's right dot to a left dot to connect</span>
            </div>
            <ReactFlow
              nodes={curGraph.nodes} edges={curGraph.edges} nodeTypes={nodeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
              onNodeClick={(_e, n) => { setSelNodeId(n.id); setTab('build'); }}
              onPaneClick={() => setSelNodeId(null)}
              defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: 'rgba(10,10,10,.35)', strokeWidth: 1.5 } }}
              fitView proOptions={{ hideAttribution: true }} deleteKeyCode={['Backspace', 'Delete']}
              onNodesDelete={(ns) => { if (ns.some((n) => n.id === selNodeId)) setSelNodeId(null); setDirty(true); }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="rgba(10,10,10,.14)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(n) => KIND[(n.type as NodeKind) || 'action'].color} style={{ background: 'var(--white)' }} />
            </ReactFlow>
          </div>

          {/* right panel */}
          <div style={{ width: 320, flexShrink: 0, background: 'var(--white)', borderLeft: '1px solid var(--ink-10)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ height: 44, borderBottom: '1px solid var(--ink-10)', display: 'flex', flexShrink: 0 }}>
              {([{ id: 'build', label: 'Build', Icon: I.gear }, { id: 'prompt', label: 'Prompt', Icon: I.terminal }, { id: 'test', label: 'Test', Icon: I.play }] as const).map((tb) => (
                <div key={tb.id} onClick={() => setTab(tb.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 12.5, fontWeight: tab === tb.id ? 700 : 400, color: tab === tb.id ? 'var(--ink)' : 'var(--ink-45)', cursor: 'pointer', borderBottom: tab === tb.id ? '2.5px solid var(--ink)' : '2.5px solid transparent', marginBottom: -1 }}>
                  <tb.Icon size={13} /> {tb.label}
                </div>
              ))}
            </div>
            {tab === 'build' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {selNode ? (
                  <NodeEditor node={selNode} actions={actions} update={(p) => updateNode(selNode.id, p)} onDelete={() => deleteNode(selNode.id)} flash={flash} setActions={setActions} />
                ) : (
                  <>
                    <StateEditor pb={pb} state={selState} flow={curGraph} update={editState} onDelete={() => deleteState(selState.key)} />
                    <div style={{ height: 0, borderTop: '1px solid var(--ink-10)' }} />
                    <WorkflowManager
                      workflows={cur}
                      selWorkflowId={selWorkflowId}
                      onSelect={(id) => { setSelWorkflowId(id); setSelNodeId(null); }}
                      onAdd={() => addWorkflow()}
                      onRename={renameWorkflow}
                      onDelete={deleteWorkflow}
                    />
                  </>
                )}
              </div>
            )}
            {tab === 'prompt' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--ink-05)' }}><div style={{ fontSize: 14, fontWeight: 700 }}>{selState.label} — system prompt</div><div style={{ fontSize: 10.5, color: 'var(--ink-45)', marginTop: 2 }}>Assembled live from persona + tone + wired tools</div></div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}><textarea readOnly value={prompt} style={{ width: '100%', height: '100%', minHeight: 320, padding: '11px 12px', fontSize: 11.5, fontFamily: 'ui-monospace, monospace', border: '1px solid var(--ink-10)', borderRadius: 9, background: 'var(--black)', color: 'rgba(255,255,255,.88)', outline: 'none', resize: 'none', lineHeight: 1.8 }} /></div>
              </div>
            )}
            {tab === 'test' && <LiveChat stateLabel={selState.label} />}
          </div>
        </div>
      </div>

      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 200, fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 9, background: toast.includes('failed') ? 'var(--red)' : 'var(--ink)', color: '#fff', boxShadow: '0 6px 24px rgba(0,0,0,.22)' }}>{toast}</div>}
      {publishOpen && <PublishModal pb={pb} dirty={dirty} onSaveFirst={save} onClose={() => setPublishOpen(false)} onDone={(p) => setPb(p)} />}
    </div>
  );
}

/* ── Workflow chip (canvas-area selector) ── */
function WorkflowChip({ wf, idx, selected, onClick, onRename, onDelete }: { wf: Workflow; idx: number; selected: boolean; onClick: () => void; onRename: (newLabel: string) => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(wf.label);
  const color = workflowColor(idx);
  useEffect(() => { if (!editing) setDraft(wf.label); }, [wf.label, editing]);
  function commit() {
    const t = draft.trim();
    if (t && t !== wf.label) onRename(t);
    setEditing(false);
  }
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!editing) onClick(); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: selected ? 700 : 500, color: selected ? 'var(--ink)' : 'var(--ink-70)', background: selected ? 'var(--ink-05)' : 'transparent', border: `1px solid ${selected ? 'var(--ink-22)' : 'var(--ink-10)'}`, borderLeft: `3px solid ${color}`, borderRadius: 7, padding: '4px 8px 4px 7px', cursor: editing ? 'text' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setDraft(wf.label); setEditing(false); } }}
          onClick={(e) => e.stopPropagation()}
          style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', width: 110, padding: 0 }}
        />
      ) : (
        <>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{wf.label}</span>
          <span style={{ fontSize: 9.5, color: 'var(--ink-45)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{wf.nodes.length}</span>
          {hover && (
            <>
              <span onClick={(e) => { e.stopPropagation(); setDraft(wf.label); setEditing(true); }} title="Rename" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: 'var(--ink-45)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✎</span>
              <span onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, color: 'var(--red)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</span>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Workflow manager (right-panel list) ── */
function WorkflowManager({ workflows, selWorkflowId, onSelect, onAdd, onRename, onDelete }: { workflows: Workflow[]; selWorkflowId: string | null; onSelect: (id: string) => void; onAdd: () => void; onRename: (id: string, label: string) => void; onDelete: (id: string) => void }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-45)' }}>
          <span style={{ display: 'inline-flex', color: 'var(--ink-45)' }}><I.cycle size={11} /></span>
          Workflows ({workflows.length})
        </span>
        <button onClick={onAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 700, color: 'var(--ink)', background: 'var(--ink-05)', border: '1px solid var(--ink-10)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}>
          <I.plus size={10} /> New
        </button>
      </div>
      {workflows.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-45)', padding: '14px 12px', border: '1px dashed var(--ink-22)', borderRadius: 8, textAlign: 'center', background: 'var(--bg)' }}>
          No workflows yet. Click <span style={{ fontWeight: 700, color: 'var(--ink-70)' }}>+ New</span> to add one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {workflows.map((wf, idx) => (
            <WorkflowCard
              key={wf.id}
              wf={wf}
              idx={idx}
              selected={wf.id === selWorkflowId}
              onSelect={() => onSelect(wf.id)}
              onRename={(l) => onRename(wf.id, l)}
              onDelete={() => onDelete(wf.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowCard({ wf, idx, selected, onSelect, onRename, onDelete }: { wf: Workflow; idx: number; selected: boolean; onSelect: () => void; onRename: (label: string) => void; onDelete: () => void }) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(wf.label);
  const color = workflowColor(idx);
  useEffect(() => { if (!editing) setDraft(wf.label); }, [wf.label, editing]);
  function commit() {
    const t = draft.trim();
    if (t && t !== wf.label) onRename(t);
    setEditing(false);
  }
  const triggers = wf.nodes.filter((n) => n.type === 'trigger').length;
  const actions = wf.nodes.filter((n) => n.type === 'action').length;
  const fallbacks = wf.nodes.filter((n) => n.type === 'fallback').length;
  const counts: string[] = [];
  if (triggers) counts.push(triggers + ' trigger' + (triggers === 1 ? '' : 's'));
  if (actions) counts.push(actions + ' action' + (actions === 1 ? '' : 's'));
  if (fallbacks) counts.push(fallbacks + ' fallback' + (fallbacks === 1 ? '' : 's'));
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!editing) onSelect(); }}
      style={{
        padding: '8px 10px 8px 9px',
        border: `1.5px solid ${selected ? 'var(--ink-22)' : 'var(--ink-10)'}`,
        borderLeft: `3px solid ${color}`,
        background: selected ? 'var(--ink-05)' : 'var(--white)',
        borderRadius: 8,
        cursor: editing ? 'text' : 'pointer',
        transition: 'border-color 0.12s var(--ease), background 0.12s var(--ease)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: selected ? `0 0 0 2px ${color}22` : 'none' }} />
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setDraft(wf.label); setEditing(false); } }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'var(--white)', border: `1px solid ${color}`, borderRadius: 5, padding: '2px 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
          />
        ) : (
          <>
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: selected ? 700 : 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wf.label}</span>
            {hover && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                <button onClick={(e) => { e.stopPropagation(); setDraft(wf.label); setEditing(true); }} title="Rename" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: 'var(--ink-45)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px', lineHeight: 1 }}>✎</button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete" style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px', lineHeight: 1 }}>✕</button>
              </span>
            )}
          </>
        )}
      </div>
      {counts.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-45)', paddingLeft: 16, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{counts.join(' · ')}</div>
      )}
    </div>
  );
}

/* ── State panel ── */
function StatePanel({ pb, selStateKey, onSelect, onAdd, onDelete }: { pb: Playbook; selStateKey: string; onSelect: (k: string) => void; onAdd: () => void; onDelete: (k: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--bg)', borderRight: '1px solid var(--ink-10)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--ink-10)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--ink-45)', display: 'flex' }}><I.cycle /></span>
        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.015em', flex: 1 }}>State Management</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
        {pb.states.map((s, i) => {
          const color = stateColor(s.key, i);
          const isSel = selStateKey === s.key;
          return (
            <div key={s.key} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(s.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', cursor: 'pointer', background: isSel ? 'var(--white)' : 'transparent', boxShadow: isSel ? `inset 2px 0 0 ${color}` : 'none' }}>
              <span style={{ width: 3, height: 22, borderRadius: 100, background: color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ink)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.description}</div>
              </div>
              {hover === s.key && s.key !== pb.defaultState && <span onClick={(e) => { e.stopPropagation(); onDelete(s.key); }} title="Delete" style={{ color: 'var(--red)', display: 'flex' }}><I.trash /></span>}
            </div>
          );
        })}
      </div>
      <button onClick={onAdd} style={{ margin: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', background: 'var(--white)', border: '1px dashed var(--ink-22)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}><I.plus /> Add state</button>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--ink-45)', marginBottom: 7 };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 12.5, border: '1px solid var(--ink-10)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit' };
const iconBtn: React.CSSProperties = { width: 32, height: 32, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-70)', borderRadius: 7, display: 'grid', placeItems: 'center' };
const ghostBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'none', border: '1px solid var(--ink-10)', borderRadius: 7, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--ink-70)', cursor: 'pointer' };

/* ── Node editor (right panel) ── */
function NodeEditor({ node, actions, update, onDelete, flash, setActions }: { node: Node; actions: Action[]; update: (p: any) => void; onDelete: () => void; flash: (m: string) => void; setActions: (a: Action[]) => void }) {
  const d = node.data as any;
  const kind = node.type as NodeKind;
  const k = KIND[kind];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'flex', color: k.color }}><k.Icon /></span>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: k.color, flex: 1 }}>{k.label}</span>
        <button onClick={onDelete} title="Delete node" style={{ display: 'flex', color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}><I.trash /></button>
      </div>

      {kind === 'trigger' && <TriggerForm d={d} update={update} />}
      {kind === 'action' && <ActionForm d={d} actions={actions} update={update} flash={flash} setActions={setActions} />}
      {kind === 'fallback' && <FallbackForm d={d} update={update} />}
    </>
  );
}

function TriggerForm({ d, update }: { d: any; update: (p: any) => void }) {
  const cond = d.condition || {};
  return (
    <>
      <div><div style={lbl}>Label</div><input value={d.label || ''} onChange={(e) => update({ label: e.target.value })} style={inp} /></div>
      <div><div style={lbl}>Event</div><select value={d.event?.type || 'message_received'} onChange={(e) => update({ event: { type: e.target.value } })} style={inp}>{EVENTS.map((ev) => <option key={ev} value={ev}>{ev.replace(/_/g, ' ')}</option>)}</select></div>
      <div><div style={lbl}>Condition</div>
        <select value={cond.type || 'always'} onChange={(e) => update({ condition: e.target.value === 'message_contains' ? { type: 'message_contains', phrases: [], matchType: 'any' } : e.target.value === 'state_is' ? { type: 'state_is', state: '' } : e.target.value === 'consecutive_failures' ? { type: 'consecutive_failures', count: 2 } : e.target.value === 'message_intent' ? { type: 'message_intent', intent: '', minConfidence: 0.6 } : { type: 'always' } })} style={{ ...inp, marginBottom: 8 }}>
          {COND_TYPES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </select>
        {cond.type === 'message_contains' && (<>
          <input value={(cond.phrases || []).join(', ')} placeholder="phrases, comma-separated" onChange={(e) => update({ condition: { ...cond, phrases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })} style={{ ...inp, marginBottom: 8 }} />
          <select value={cond.matchType || 'any'} onChange={(e) => update({ condition: { ...cond, matchType: e.target.value } })} style={inp}><option value="any">match any</option><option value="all">match all</option></select>
        </>)}
        {cond.type === 'consecutive_failures' && <input type="number" value={cond.count || 2} onChange={(e) => update({ condition: { type: 'consecutive_failures', count: Number(e.target.value) } })} style={inp} />}
        {cond.type === 'message_intent' && <input value={cond.intent || ''} placeholder="intent name" onChange={(e) => update({ condition: { type: 'message_intent', intent: e.target.value, minConfidence: 0.6 } })} style={inp} />}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-22)' }}>Connect this trigger's right dot to an Action to define what it runs.</div>
    </>
  );
}

function ActionForm({ d, actions, update, flash, setActions }: { d: any; actions: Action[]; update: (p: any) => void; flash: (m: string) => void; setActions: (a: Action[]) => void }) {
  const exposed = actions.filter((a) => a.exposed);
  const action = actions.find((a) => a.key === d.actionKey) || null;
  async function patch(p: Partial<Action>) {
    if (!action) return;
    setActions(actions.map((a) => (a.id === action.id ? { ...a, ...p } : a)));
    try { await api(`/actions/${action.id}`, { method: 'PATCH', body: p }); flash('Saved'); } catch (e: any) { flash('Save failed: ' + (e?.message || '')); }
  }
  return (
    <>
      <div><div style={lbl}>Tool</div>
        <select value={d.actionKey || ''} onChange={(e) => { const a = actions.find((x) => x.key === e.target.value); update({ actionKey: e.target.value, label: a?.label, tier: a?.tier, method: a?.method, path: a?.path }); }} style={inp}>
          <option value="">— pick a tool —</option>
          {exposed.map((a) => <option key={a.key} value={a.key}>{a.label} (T{a.tier})</option>)}
        </select>
      </div>
      {action && (<>
        <div style={{ fontSize: 10.5, color: 'var(--ink-45)', fontFamily: 'ui-monospace, monospace' }}>{action.method} {action.path}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--ink-10)', borderRadius: 9, background: 'var(--bg)' }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>Exposed to agent</div><div style={{ fontSize: 10.5, color: 'var(--ink-45)' }}>{action.exposed ? 'Callable' : 'Hidden'}</div></div>
          <Switch on={action.exposed} onClick={() => patch({ exposed: !action.exposed })} label={action.label ? `Toggle ${action.label} exposed` : 'Toggle action exposed'} />
        </div>
        <div><div style={lbl}>Tier</div><select value={action.tier} onChange={(e) => patch({ tier: Number(e.target.value) })} style={inp}>{[0, 1, 2, 3].map((t) => <option key={t} value={t}>Tier {t}</option>)}</select></div>
        <div><div style={lbl}>Confirmation copy</div><textarea defaultValue={action.confirmationCopy || ''} onBlur={(e) => { if (e.target.value !== (action.confirmationCopy || '')) patch({ confirmationCopy: e.target.value }); }} style={{ ...inp, minHeight: 56, resize: 'vertical' }} /></div>
        {action.tier === 0 && <button onClick={async () => { try { const r = await api(`/actions/${action.id}/test`, { method: 'POST', body: { args: {} } }); flash('Tested ✓ ' + JSON.stringify(r).slice(0, 46)); } catch (e: any) { flash('Test failed'); } }} style={{ padding: '8px 0', fontSize: 12.5, fontWeight: 600, background: 'var(--ink-05)', border: '1px solid var(--ink-10)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Test (Tier-0)</button>}
      </>)}
      <div style={{ fontSize: 11, color: 'var(--ink-22)' }}>Wiring this action into the flow exposes it as a tool in this state.</div>
    </>
  );
}

function FallbackForm({ d, update }: { d: any; update: (p: any) => void }) {
  const cfg = d.config || {};
  const messageTemplate = cfg.messageTemplate || '';
  const matched = ERROR_TYPES.find((et) => et.strategy === d.strategy && et.message === messageTemplate);
  const curErrorKey = matched?.key ?? '__custom__';
  function onErrorTypeChange(key: string) {
    if (key === '__custom__') return;
    const et = ERROR_TYPES.find((x) => x.key === key);
    if (!et) return;
    update({ strategy: et.strategy, config: { ...cfg, messageTemplate: et.message } });
  }
  return (
    <>
      <div><div style={lbl}>Error Type</div><select value={curErrorKey} onChange={(e) => onErrorTypeChange(e.target.value)} style={inp}>{ERROR_TYPES.map((et) => <option key={et.key} value={et.key}>{et.label}</option>)}<option value="__custom__">— Custom —</option></select></div>
      <div><div style={lbl}>Strategy</div><select value={d.strategy || 'rephrase'} onChange={(e) => update({ strategy: e.target.value })} style={inp}>{STRATEGIES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></div>
      <div><div style={lbl}>Max attempts</div><input type="number" value={cfg.maxAttempts ?? 1} onChange={(e) => update({ config: { ...cfg, maxAttempts: Number(e.target.value) } })} style={inp} /></div>
      <div><div style={lbl}>Message template</div><textarea value={messageTemplate} placeholder="Use {options} / {missing}" onChange={(e) => update({ config: { ...cfg, messageTemplate: e.target.value } })} style={{ ...inp, minHeight: 66, resize: 'vertical' }} /></div>
    </>
  );
}

/* ── State editor (no node selected) ── */
function StateEditor({ pb, state, flow, update, onDelete }: { pb: Playbook; state: PlaybookState; flow: { nodes: Node[]; edges: Edge[] }; update: (p: Partial<PlaybookState>) => void; onDelete: () => void }) {
  const toolCount = flow.nodes.filter((n) => n.type === 'action').length;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: stateColor(state.key), flex: 1 }}>STATE · {state.key}</span>
        {state.key !== pb.defaultState && <button onClick={onDelete} title="Delete state" style={{ display: 'flex', color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}><I.trash /></button>}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-45)' }}>Click a node to edit it, or use the palette to add Trigger / Action / Fallback nodes and wire them.</div>
      <div><div style={lbl}>Label</div><input value={state.label} onChange={(e) => update({ label: e.target.value })} style={inp} /></div>
      <div><div style={lbl}>Description</div><input value={state.description} onChange={(e) => update({ description: e.target.value })} style={inp} /></div>
      <div><div style={lbl}>Persona</div><textarea value={state.persona} onChange={(e) => update({ persona: e.target.value })} style={{ ...inp, minHeight: 100, resize: 'vertical', lineHeight: 1.55 }} /></div>
      <div><div style={lbl}>Tone (one per line)</div><textarea value={state.toneGuidelines.join('\n')} onChange={(e) => update({ toneGuidelines: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} style={{ ...inp, minHeight: 64, resize: 'vertical', lineHeight: 1.55 }} /></div>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}><div style={lbl}>Opening</div><select value={state.openingBehavior} onChange={(e) => update({ openingBehavior: e.target.value })} style={inp}>{OPENING.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</select></div>
        <div style={{ width: 96 }}><div style={lbl}>Confirm ≥ tier</div><select value={state.requireConfirmationForTier} onChange={(e) => update({ requireConfirmationForTier: Number(e.target.value) })} style={inp}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
      </div>
      <div><div style={lbl}>Confidence floor: {state.confidenceFloor.toFixed(2)}</div><input type="range" min={0} max={1} step={0.05} value={state.confidenceFloor} onChange={(e) => update({ confidenceFloor: Number(e.target.value) })} style={{ width: '100%' }} /></div>
      <div style={{ fontSize: 11.5, padding: '8px 10px', borderRadius: 8, background: 'var(--blue-bg, rgba(53,98,200,.07))', color: 'var(--ink-70)' }}><b>{toolCount}</b> action node{toolCount === 1 ? '' : 's'} wired — these become this state's tools on Save.</div>
    </>
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return <button role="switch" aria-checked={on} aria-label={label || (on ? 'On' : 'Off')} onClick={onClick} style={{ width: 34, height: 19, borderRadius: 999, background: on ? 'var(--green)' : 'var(--ink-10)', position: 'relative', border: 'none', cursor: 'pointer', flexShrink: 0 }}><span style={{ position: 'absolute', top: 2, left: on ? 17 : 2, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} /></button>;
}

/* ── Publish modal ── */
function PublishModal({ pb, dirty, onSaveFirst, onClose, onDone }: { pb: Playbook; dirty: boolean; onSaveFirst: () => Promise<void>; onClose: () => void; onDone: (p: Playbook) => void }) {
  const [mode, setMode] = useState<'immediate' | 'shadow' | 'gradual'>('immediate');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false);
  const publishTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { return () => { if (publishTimeoutRef.current) clearTimeout(publishTimeoutRef.current); }; }, []);
  async function deploy() {
    setBusy(true); setErr(null);
    try { if (dirty) await onSaveFirst(); await api(`/playbooks/${pb.id}/deploy`, { method: 'POST', body: { mode } }); setDone(true); onDone({ ...pb, status: 'active' }); publishTimeoutRef.current = setTimeout(onClose, 900); }
    catch (e: any) { setErr(e?.message || 'Deploy failed'); } finally { setBusy(false); }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--white)', borderRadius: 14, width: 420, padding: 26, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><I.upload /><span style={{ fontSize: 17, fontWeight: 700 }}>Publish playbook</span></div>
        <p style={{ fontSize: 13, color: 'var(--ink-45)', marginBottom: 18 }}>Deploy v{pb.version} to your live agent.{dirty ? ' Unsaved edits are saved first.' : ''}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {(['immediate', 'shadow', 'gradual'] as const).map((m) => (
            <div key={m} onClick={() => setMode(m)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: `1.5px solid ${mode === m ? 'var(--ink)' : 'var(--ink-10)'}`, cursor: 'pointer', textTransform: 'capitalize' }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${mode === m ? 'var(--ink)' : 'var(--ink-22)'}`, background: mode === m ? 'var(--ink)' : 'transparent' }} />
              <div><div style={{ fontSize: 13, fontWeight: 600 }}>{m}</div><div style={{ fontSize: 11, color: 'var(--ink-45)' }}>{m === 'immediate' ? 'Roll out to everyone now' : m === 'shadow' ? 'Run silently alongside current' : 'Gradually ramp traffic'}</div></div>
            </div>
          ))}
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'var(--white)', border: '1px solid var(--ink-10)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={deploy} disabled={busy || done} style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: done ? 'var(--green)' : 'var(--ink)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>{done ? '✓ Published' : busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      </div>
    </div>
  );
}
