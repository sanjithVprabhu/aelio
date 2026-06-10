// Server-side API client for the Aelio admin dashboard.
// All fetches are no-store so pages render live data. Failures are caught and
// surfaced as a typed result so server components can render an offline state
// rather than crashing the render/build.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export const TENANT_SLUG = 'acme';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, error: `API responded ${res.status} for ${path}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown network error',
    };
  }
}

export function tenantPath(suffix: string): string {
  return `/api/v1/t/${TENANT_SLUG}${suffix}`;
}

// ---------- Domain types ----------

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  region: string;
};

export type Overview = {
  conversations: number;
  escalations: number;
  actionsExposed: number;
  states: { state: string; count: number }[];
  resolutionRate: number;
};

export type ActionPolicy = {
  id: string;
  key: string;
  label: string;
  method: string;
  path: string;
  tier: string | number;
  exposed: boolean;
  stepUpRequired: boolean;
  rateLimitPerUserPerHour: number;
  description: string;
};

export type Playbook = {
  id: string;
  version: string | number;
  status: string;
  defaultState: string;
  states: {
    key: string;
    label: string;
    description: string;
    openingBehavior: string;
    allowedActions: string[];
    requireConfirmationForTier: string | number;
  }[];
  triggers: { id: string; label: string; enabled: boolean }[];
  fallbackLadder: { order: number; strategy: string; config: unknown }[];
};

export type ConversationSummary = {
  id: string;
  status: string;
  channel: string;
  state: string;
  displayName: string;
  lastActivityAt: string;
  turns: number;
};

export type ConversationDetail = {
  id: string;
  state: string;
  status: string;
  turns: { role: string; text: string; meta?: unknown; at: string }[];
  invocations: {
    id?: string;
    actionKey?: string;
    key?: string;
    status?: string;
    tier?: string | number;
    at?: string;
    [k: string]: unknown;
  }[];
};

export type InboxItem = {
  id: string;
  conversationId: string;
  displayName: string;
  reason: string;
  priority: string;
  status: string;
  createdAt: string;
};

export type Analytics = {
  totalConversations: number;
  escalations: number;
  escalationRate: number;
  actionInvocations: number;
  topActions: { key: string; count: number; successRate: number }[];
  stateDistribution: { state: string; count: number }[];
};

export type AuditEvent = {
  id: string;
  eventType: string;
  conversationId: string | null;
  payload: unknown;
  at: string;
};

export type Channel = {
  id: string;
  type: string;
  status: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  config: Record<string, unknown>;
};

export type EndUser = {
  id: string;
  externalUserId: string;
  displayName: string;
  verificationStatus: string;
  currentUserState: string;
  plan: string;
};

export type Settings = {
  llm: { mode: string; provider: string; model: string };
  compliance: { region: string; retention: string; piiRedaction: boolean };
  plan: string;
};
