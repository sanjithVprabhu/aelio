export enum PlaybookStatus {
  Draft = 'draft',
  Shadow = 'shadow',
  Gradual = 'gradual',
  Active = 'active',
  Archived = 'archived',
}

export type DeploymentMode = 'immediate' | 'shadow' | 'gradual';

export type OpeningBehavior =
  | 'full_intro'
  | 'brief_greeting'
  | 'skip_to_intent'
  | 'retention_mode';

export interface BehaviorBundle {
  persona: string;
  toneGuidelines: string[];
  openingBehavior: OpeningBehavior;
  allowedActionKeys: string[]; // ['*'] or specific keys
  kbScopeIds: string[];
  skillPacks: string[];
  maxResponseLength?: number;
  confidenceFloor: number; // default 0.6
  requireConfirmationForTier: number; // default 1
  /** Per-state visual flow graph authored in the builder (nodes + edges). */
  flow?: StateFlow;
}

export interface FlowNode {
  id: string;
  type: 'trigger' | 'action' | 'fallback';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
}
export interface StateFlow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface PlaybookState {
  key: string;
  label: string;
  description: string;
  inferenceHints: string[];
  behavior: BehaviorBundle;
}

export interface PlaybookLifecycle {
  defaultState: string;
  states: PlaybookState[];
}

export type TriggerEvent =
  | { type: 'message_received' }
  | { type: 'action_succeeded'; actionKey: string }
  | { type: 'action_failed'; actionKey: string }
  | { type: 'state_entered'; state: string }
  | { type: 'session_started' }
  | { type: 'escalation_requested' };

export type TriggerCondition =
  | { type: 'message_contains'; phrases: string[]; matchType: 'any' | 'all' }
  | { type: 'message_intent'; intent: string; minConfidence: number }
  | { type: 'state_is'; state: string }
  | { type: 'action_count'; actionKey: string; operator: '>=' | '<='; count: number }
  | { type: 'consecutive_failures'; count: number }
  | { type: 'and'; conditions: TriggerCondition[] }
  | { type: 'or'; conditions: TriggerCondition[] };

export type TriggerAction =
  | { type: 'transition_state'; targetState: string }
  | { type: 'escalate_to_human'; reason: string; priority: 'normal' | 'urgent' }
  | { type: 'send_message'; templateKey: string }
  | { type: 'invoke_action'; actionKey: string; args?: Record<string, unknown> }
  | { type: 'set_metadata'; key: string; value: unknown };

export interface PlaybookTrigger {
  id: string;
  label: string;
  enabled: boolean;
  event: TriggerEvent;
  condition: TriggerCondition;
  action: TriggerAction;
}

export type FallbackStrategy =
  | 'typo_correction'
  | 'slot_reprompt'
  | 'rephrase'
  | 'offer_options'
  | 'escalate';

export interface FallbackStep {
  order: number;
  strategy: FallbackStrategy;
  config: { maxAttempts: number; messageTemplate: string };
}

export interface Playbook {
  id: string;
  tenantId: string;
  version: string; // semver
  status: PlaybookStatus;
  deploymentMode?: DeploymentMode;
  gradualRolloutPercent?: number;
  lifecycle: PlaybookLifecycle;
  triggers: PlaybookTrigger[];
  fallbackLadder: FallbackStep[];
  messageTemplates: Record<string, string>;
  bootstrappedFromSpecId?: string;
  createdAt: Date;
  publishedAt?: Date;
}
