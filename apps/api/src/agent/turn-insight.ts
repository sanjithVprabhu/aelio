import { randomUUID } from 'node:crypto';
import type { StateManifest } from '@aelio/convox-sdk';
import type { HarnessPhase } from './harness.js';
import type { ActiveIntent } from './intent-engine.js';
import type { ConvoxPhaseState, ObjectiveStatus } from '../convox/state-engine.js';
import type { FlowDefinition, FlowStep } from '../flows/flow-engine.js';
import { findFlowForObjective, nextFlowStep } from '../flows/flow-engine.js';
import type { RuntimeReply } from './runtime.js';

export interface FlowStepInsight {
  order: number;
  label: string;
  toolKey?: string;
  prompt?: string;
  active: boolean;
}

export interface FlowInsight {
  stateKey: string;
  objectiveKey: string;
  flowId: string;
  currentStep: FlowStepInsight | null;
  steps: FlowStepInsight[];
}

export interface TurnInsight {
  turnId: string;
  at: string;
  context: {
    tenantId: string;
    tenantSlug?: string;
    conversationId?: string;
    identityId?: string;
    identifier?: string;
  };
  inbound: { message: string; channel: string };
  outbound: {
    repliedBy: 'agent' | 'system';
    replies: Array<{ kind: string; text: string }>;
  };
  harness: HarnessPhase[];
  intent: {
    key: string;
    args: Record<string, unknown>;
    missingSlots: string[];
    aborted: boolean;
  } | null;
  state: {
    current: string;
    previous: string | null;
    changed: boolean;
    confidence: number;
    reason?: string;
    completedObjectives: string[];
  };
  flow: FlowInsight | null;
  toolCalls: Array<{ key: string; tier: number; status: string }>;
  objectives: ObjectiveStatus[];
  model?: string;
  latencyMs?: number;
  flags: {
    needsVerification: boolean;
    awaitingConfirmation: boolean;
    stepUpRequired: boolean;
  };
}

function stepLabel(step: FlowStep): string {
  return step.prompt ?? step.toolKey ?? `step ${step.order}`;
}

function stepInsight(step: FlowStep, active: boolean): FlowStepInsight {
  return {
    order: step.order,
    label: stepLabel(step),
    toolKey: step.toolKey,
    prompt: step.prompt,
    active,
  };
}

export function resolveFlowInsight(
  flows: FlowDefinition[],
  stateManifest: StateManifest | undefined,
  phase: ConvoxPhaseState,
): FlowInsight | null {
  const remaining =
    stateManifest?.objectives?.filter((o) => !phase.completedObjectives.includes(o.key)) ?? [];
  const nextObjective = remaining[0];
  if (!nextObjective) return null;
  const flow = findFlowForObjective(flows, phase.currentState, nextObjective.key);
  if (!flow) return null;
  const active = nextFlowStep(flow);
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order);
  return {
    stateKey: flow.stateKey,
    objectiveKey: flow.objectiveKey,
    flowId: flow.id,
    currentStep: active ? stepInsight(active, true) : null,
    steps: sorted.map((s) => stepInsight(s, active?.order === s.order)),
  };
}

export function buildTurnInsight(input: {
  tenantId: string;
  tenantSlug?: string;
  conversationId?: string;
  identityId?: string;
  identifier?: string;
  message: string;
  channel: string;
  replies: RuntimeReply[];
  harness?: { phases: HarnessPhase[] };
  intent?: ActiveIntent | null;
  intentAborted?: boolean;
  phase?: ConvoxPhaseState;
  priorState?: string | null;
  stateChanged?: boolean;
  flows?: FlowDefinition[];
  stateManifest?: StateManifest;
  actions?: Array<{ key: string; tier: number; status: string }>;
  objectives?: ObjectiveStatus[];
  model?: string;
  latencyMs?: number;
  needsVerification?: boolean;
  awaitingConfirmation?: boolean;
  stepUpRequired?: boolean;
}): TurnInsight {
  const phase = input.phase;
  const systemReply = input.replies.some((r) => r.kind === 'magic_link' || r.kind === 'step_up');
  const harness = input.harness?.phases ?? (input.needsVerification ? ['RESOLVE'] : []);

  return {
    turnId: randomUUID(),
    at: new Date().toISOString(),
    context: {
      tenantId: input.tenantId,
      tenantSlug: input.tenantSlug,
      conversationId: input.conversationId,
      identityId: input.identityId,
      identifier: input.identifier,
    },
    inbound: { message: input.message, channel: input.channel },
    outbound: {
      repliedBy: systemReply ? 'system' : 'agent',
      replies: input.replies.map((r) => ({ kind: r.kind, text: r.text })),
    },
    harness,
    intent: input.intent
      ? {
          key: input.intent.intentKey,
          args: input.intent.args,
          missingSlots: input.intent.missingSlots,
          aborted: input.intentAborted ?? false,
        }
      : null,
    state: {
      current: phase?.currentState ?? 'active',
      previous: input.priorState ?? null,
      changed: input.stateChanged ?? false,
      confidence: phase?.confidence ?? 0,
      reason: phase?.reason,
      completedObjectives: phase?.completedObjectives ?? [],
    },
    flow:
      phase && input.flows
        ? resolveFlowInsight(input.flows, input.stateManifest, phase)
        : null,
    toolCalls: input.actions ?? [],
    objectives: input.objectives ?? [],
    model: input.model,
    latencyMs: input.latencyMs,
    flags: {
      needsVerification: input.needsVerification ?? false,
      awaitingConfirmation: input.awaitingConfirmation ?? false,
      stepUpRequired: input.stepUpRequired ?? false,
    },
  };
}
