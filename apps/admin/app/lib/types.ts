import type { Node, Edge } from '@xyflow/react';

export type FlowNodeData = Record<string, any>;
export type StoredFlow = {
  nodes: { id: string; type: 'trigger' | 'action' | 'fallback'; position: { x: number; y: number }; data: FlowNodeData }[];
  edges: { id: string; source: string; target: string }[];
};

/** Tag interface for node data — identifies which workflow a node belongs to on a multi-workflow canvas. */
export type WorkflowData = {
  workflowId: string;
  [key: string]: any;
};

export type Workflow = {
  id: string;
  label: string;
  nodes: Node[];
  edges: Edge[];
};

export type PlaybookState = {
  key: string;
  label: string;
  description: string;
  persona: string;
  toneGuidelines: string[];
  openingBehavior: string;
  allowedActions: string[];
  kbScopeIds: string[];
  confidenceFloor: number;
  requireConfirmationForTier: number;
  /** @deprecated Use `workflows` instead. Kept for backward compatibility. */
  flow?: StoredFlow | null;
  workflows?: Workflow[];
};

export type Trigger = {
  id: string;
  label: string;
  enabled: boolean;
  event: { type: string };
  condition: any;
  action: any;
};

export type FallbackStep = {
  order: number;
  strategy: string;
  config: { maxAttempts?: number; messageTemplate?: string };
};

export type Playbook = {
  id: string;
  version: string;
  status: string;
  defaultState: string;
  states: PlaybookState[];
  triggers: Trigger[];
  fallbackLadder: FallbackStep[];
};

export type Action = {
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
  postActionMessage?: string;
};

/** Maps a playbook state key to one of the design's lifecycle colours. */
export const STATE_COLORS: Record<string, string> = {
  unverified: '#9598A1',
  verified: '#3562C8',
  onboarding: '#3C9B6A',
  discovery: '#7C51D8',
  activation: '#B8840E',
  active: '#3562C8',
  power_user: '#C4612A',
  poweruser: '#C4612A',
  at_risk: '#C43838',
};

const PALETTE = ['#3562C8', '#3C9B6A', '#B8840E', '#7C51D8', '#9598A1', '#C43838', '#C4612A', '#1A8FA6'];
export function stateColor(key: string, idx = 0): string {
  return STATE_COLORS[key] || PALETTE[idx % PALETTE.length];
}

export const NODE_TYPES = {
  trigger: { label: 'TRIGGER', color: '#B8840E', bg: 'rgba(184,132,14,.08)' },
  action: { label: 'ACTION', color: '#3562C8', bg: 'rgba(53,98,200,.08)' },
  fallback: { label: 'FALLBACK', color: '#C43838', bg: 'rgba(196,56,56,.08)' },
} as const;

export type NodeType = keyof typeof NODE_TYPES;

/** Build the assembled system prompt for a state, mirroring the manual's prompt structure. */
export function buildSystemPrompt(state: PlaybookState, allowedActionLabels: string[]): string {
  const lines: string[] = [];
  lines.push(`# ${state.label} state`);
  lines.push('');
  lines.push(state.persona.trim());
  lines.push('');
  if (state.toneGuidelines.length) {
    lines.push('## Tone');
    state.toneGuidelines.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  lines.push('## Tools');
  if (allowedActionLabels.length) {
    lines.push('You may only use these tools:');
    allowedActionLabels.forEach((a) => lines.push(`- ${a}`));
  } else {
    lines.push('You have no tools available in this state. Guide the user verbally only.');
  }
  lines.push('');
  lines.push('## Policy');
  lines.push(`- Confidence floor: ${state.confidenceFloor}`);
  lines.push(`- Require confirmation for tier ${state.requireConfirmationForTier} actions and above.`);
  lines.push(`- Opening behaviour: ${state.openingBehavior}`);
  return lines.join('\n');
}

// ── Multi-workflow model ──
// Workflow and WorkflowData are defined inline above (after StoredFlow).
// Each PlaybookState can hold zero or more Workflows.
// Nodes are tagged with workflowId via WorkflowData to enable reconstitution
// from the flattened React Flow canvas state.
