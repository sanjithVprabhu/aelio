export type JSONSchema = Record<string, unknown>;

/** The four-tier safety model — the heart of the Policy moat. */
export enum ActionTier {
  /** Read. No confirmation. Executes immediately. */
  Read = 0,
  /** Reversible write. Inline confirmation before execution. */
  ReversibleWrite = 1,
  /** State update. Explicit before/after summary; user confirms. */
  StateUpdate = 2,
  /** Destructive/financial. Step-up auth + multi-step confirmation. */
  Destructive = 3,
}

export type ArgConstraint =
  | { type: 'max_value'; field: string; max: number }
  | { type: 'min_value'; field: string; min: number }
  | { type: 'allowed_values'; field: string; values: string[] }
  | { type: 'regex'; field: string; pattern: string }
  | { type: 'not_equal'; field: string; value: unknown };

export type PreCondition =
  | { type: 'user_context_field'; field: string; operator: '==' | '!=' | '>' | '<'; value: unknown }
  | { type: 'session_step_up_valid' }
  | { type: 'no_pending_action'; actionKey: string };

export interface ActionDefinition {
  id: string;
  tenantId: string;
  specId: string;
  key: string;
  label: string;
  description: string;

  httpMethod?: string;
  path?: string;
  baseUrl: string;

  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;

  // Policy (admin-configured)
  exposed: boolean;
  tier: ActionTier;
  requiredPermissions: string[];
  confirmationCopy?: string;
  beforeAfterTemplate?: string;
  stepUpRequired: boolean;
  rateLimitPerUserPerHour: number;
  argConstraints: ArgConstraint[];
  preConditions: PreCondition[];

  postActionMessage: string;
  auditFields: string[];

  createdAt: Date;
  updatedAt: Date;
}

export interface ActionInvocation {
  id: string; // auditEventId (ULID)
  tenantId: string;
  conversationId: string;
  identityId: string;
  actionKey: string;
  tier: ActionTier;
  status: 'invoked' | 'succeeded' | 'failed' | 'blocked';
  argsRedacted: Record<string, unknown>;
  responseFields?: Record<string, unknown>;
  errorMessage?: string;
  latencyMs?: number;
  createdAt: Date;
}

export interface PendingConfirmation {
  id: string;
  token: string;
  tenantId: string;
  conversationId: string;
  actionKey: string;
  confirmedArgs: Record<string, unknown>;
  expiresAt: Date;
  consumedAt?: Date;
  createdAt: Date;
}
