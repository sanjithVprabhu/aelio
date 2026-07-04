/** JSON Schema object describing tool arguments (LLM + server validation). */
export type JSONSchema = Record<string, unknown>;

/** A goal the assistant should guide the user toward within a conversation state. */
export interface StateObjective {
  key: string;
  description: string;
  /** When this tool succeeds, the objective is marked complete. */
  satisfiedByTool?: string;
  /** Hints for Aelio when inferring completion from conversation. */
  signals?: string;
}

/**
 * Customer-defined conversation phase — Aelio infers the active state and
 * guides the user toward {@link StateObjective}s. Tools are an optional allowlist.
 */
export interface StateManifest {
  key: string;
  description: string;
  /** LLM boundary: what to focus on in this phase. */
  guidance: string;
  /** Hints to help Aelio infer this state from conversation. */
  signals?: string;
  /** Optional tool allowlist; omit to expose the full Convox catalog. */
  tools?: string[];
  objectives?: StateObjective[];
}

/** Policy overrides for a tool — synced to Aelio's policy layer. */
export interface ToolPolicy {
  /** 0=read, 1=reversible write, 2=state update, 3=destructive. */
  tier?: 0 | 1 | 2 | 3;
  exposed?: boolean;
  stepUpRequired?: boolean;
  rateLimitPerUserPerHour?: number;
  confirmationCopy?: string;
  requiredPermissions?: string[];
}

/** Ordered step in an objective flow playbook. */
export interface FlowStep {
  order: number;
  toolKey?: string;
  prompt?: string;
}

/**
 * Playbook for a state objective — enforced step order in the harness PLAN phase.
 */
export interface FlowManifest {
  stateKey: string;
  objectiveKey: string;
  steps: FlowStep[];
  /** SDK-pushed flows default to approved. */
  approved?: boolean;
}

/** Serializable tool metadata pushed to the Aelio registry (no handler). */
export interface ToolManifest {
  key: string;
  description: string;
  inputSchema: JSONSchema;
  /** Optional schema/handler version for drift detection. */
  version?: string;
  /** Optional policy overrides (tier, rate limits, confirmation). */
  policy?: ToolPolicy;
}

/** User + session context attached to every execute request from Aelio. */
export interface ExecuteContext {
  invocationId: string;
  tenantId: string;
  externalUserId: string;
  email?: string;
  verified: boolean;
  stepUpValid: boolean;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

/** Payload signed by the customer backend to bind a widget session to a user. */
export interface IdentityAssertion {
  sessionId: string;
  userId: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  description: string;
  inputSchema: JSONSchema;
  version?: string;
  /** Policy overrides for this tool on the Aelio server. */
  policy?: ToolPolicy;
  handler: (ctx: ExecuteContext, args: TArgs) => Promise<TResult> | TResult;
}

export interface ConvoxConfig {
  /** Tenant slug or id configured in Aelio. */
  tenantId: string;
  /** Tenant API key — authenticates the WebSocket and signs identity assertions. */
  apiKey: string;
  /**
   * Base URL of the Aelio API (`https://api.aelio.com` or self-hosted).
   * The SDK derives the Convox WebSocket path from this.
   */
  aelioBaseUrl: string;
  /** Stable id for this SDK process (auto-generated when omitted). */
  instanceId?: string;
  /** Sent on connect for protocol compatibility checks. */
  convoxVersion?: string;
  /** Interval for heartbeat frames. Default 20_000 ms. */
  heartbeatIntervalMs?: number;
  /** Max time to wait for a handler before returning a timeout error. Default 10_000 ms. */
  executeTimeoutMs?: number;
  /** Max time to wait for the server to acknowledge registration. Default 10_000 ms. */
  registerTimeoutMs?: number;
  /** Reconnect automatically after disconnect. Default true. */
  reconnect?: boolean;
  /** Initial reconnect delay. Default 1_000 ms. */
  reconnectMinDelayMs?: number;
  /** Max reconnect delay cap. Default 30_000 ms. */
  reconnectMaxDelayMs?: number;
  /** Optional HTTP endpoint that receives push_event payloads (fire-and-forget). */
  webhookUrl?: string;
}

export type ConvoxEventMap = {
  connected: { connectionId: string };
  disconnected: { code: number; reason: string };
  error: Error;
  execute: { tool: string; invocationId: string };
  push: { eventType: string; payload: Record<string, unknown> };
  'tool:registered': { key: string };
  'tool:removed': { key: string };
  'state:registered': { key: string };
  'state:removed': { key: string };
  'flow:registered': { stateKey: string; objectiveKey: string };
  'flow:removed': { stateKey: string; objectiveKey: string };
  'policy:updated': { key: string };
};
