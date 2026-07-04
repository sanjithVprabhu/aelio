import type { ActionDefinition, LLMClient } from '@aelio/types';
import type { Kv } from '../store/kv.js';
import { matchDeterministicIntent } from './intent-routes.js';

export interface ActiveIntent {
  intentKey: string;
  args: Record<string, unknown>;
  missingSlots: string[];
  startedAt: number;
  lastActivityAt: number;
  ttlMs: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const ABORT_WORDS = ['cancel', 'never mind', 'stop', 'abort', 'forget it'];

function storageKey(tenantId: string, identityId: string): string {
  return `active_intent:${tenantId}:${identityId}`;
}

export function readActiveIntent(kv: Kv, tenantId: string, identityId: string): Promise<ActiveIntent | null> {
  return kv.get<ActiveIntent>(storageKey(tenantId, identityId));
}

export async function clearActiveIntent(kv: Kv, tenantId: string, identityId: string): Promise<void> {
  await kv.del(storageKey(tenantId, identityId));
}

export function requiredSlots(schema: Record<string, unknown>): string[] {
  const req = schema.required;
  return Array.isArray(req) ? req.map(String) : [];
}

export function computeMissingSlots(schema: Record<string, unknown>, args: Record<string, unknown>): string[] {
  return requiredSlots(schema).filter((slot) => {
    const v = args[slot];
    return v === undefined || v === null || (typeof v === 'string' && !v.trim());
  });
}

export function findActionForIntent(actions: ActionDefinition[], intentKey: string): ActionDefinition | undefined {
  return actions.find((a) => a.key === intentKey || a.key.includes(intentKey));
}

export async function resolveActiveIntent(input: {
  kv: Kv;
  llm: LLMClient;
  tenantId: string;
  identityId: string;
  conversationId: string;
  message: string;
  actions: ActionDefinition[];
  prior?: ActiveIntent | null;
}): Promise<{ intent: ActiveIntent | null; aborted: boolean }> {
  const now = Date.now();
  let prior = input.prior ?? (await readActiveIntent(input.kv, input.tenantId, input.identityId));

  if (prior && now - prior.lastActivityAt > prior.ttlMs) {
    prior = null;
    await clearActiveIntent(input.kv, input.tenantId, input.identityId);
  }

  const lower = input.message.trim().toLowerCase();
  if (prior && ABORT_WORDS.some((w) => lower.includes(w))) {
    await clearActiveIntent(input.kv, input.tenantId, input.identityId);
    return { intent: null, aborted: true };
  }

  const actionKeys = input.actions.map((a) => a.key);
  const phraseMatch = matchDeterministicIntent(input.message, actionKeys);
  if (phraseMatch) {
    const action = findActionForIntent(input.actions, phraseMatch.toolKey);
    const mergedArgs = { ...phraseMatch.args, ...extractArgsFromMessage(input.message, action) };
    const missing = action
      ? computeMissingSlots(action.inputSchema as Record<string, unknown>, mergedArgs)
      : [];
    const intent: ActiveIntent = {
      intentKey: phraseMatch.toolKey,
      args: mergedArgs,
      missingSlots: missing,
      startedAt: prior?.intentKey === phraseMatch.toolKey ? prior.startedAt : now,
      lastActivityAt: now,
      ttlMs: DEFAULT_TTL_MS,
    };
    await input.kv.set(storageKey(input.tenantId, input.identityId), intent, Math.ceil(DEFAULT_TTL_MS / 1000));
    return { intent, aborted: false };
  }

  const exposedKeys = actionKeys.join(', ');
  const system = `Classify active intent. Output JSON only: {"intentKey":"tool_key_or_general","args":{}}
Known tools: ${exposedKeys}
${prior ? `Current: ${prior.intentKey}, args: ${JSON.stringify(prior.args)}` : 'No active intent.'}
Extract argument values from the latest user message into args.`;

  const resp = await input.llm.complete({
    messages: [{ role: 'user', content: input.message }],
    systemPrompt: system,
    tenantId: input.tenantId,
    conversationId: input.conversationId,
  });

  const parsed = parseIntentJson(resp.content);
  if (!parsed.intentKey || parsed.intentKey === 'general') {
    if (prior) {
      if (prior.missingSlots.length === 0) {
        await clearActiveIntent(input.kv, input.tenantId, input.identityId);
        return { intent: null, aborted: false };
      }
      const merged = mergeArgs(prior, input.message);
      const action = findActionForIntent(input.actions, prior.intentKey);
      const missing = action ? computeMissingSlots(action.inputSchema as Record<string, unknown>, merged) : [];
      const updated: ActiveIntent = { ...prior, args: merged, missingSlots: missing, lastActivityAt: now, ttlMs: DEFAULT_TTL_MS };
      await input.kv.set(storageKey(input.tenantId, input.identityId), updated, Math.ceil(DEFAULT_TTL_MS / 1000));
      return { intent: updated, aborted: false };
    }
    return { intent: null, aborted: false };
  }

  const action = findActionForIntent(input.actions, parsed.intentKey);
  const mergedArgs = {
    ...(prior?.intentKey === parsed.intentKey ? prior.args : {}),
    ...parsed.args,
    ...extractArgsFromMessage(input.message, action),
  };
  const missing = action ? computeMissingSlots(action.inputSchema as Record<string, unknown>, mergedArgs) : [];

  const intent: ActiveIntent = {
    intentKey: parsed.intentKey,
    args: mergedArgs,
    missingSlots: missing,
    startedAt: prior?.intentKey === parsed.intentKey ? prior.startedAt : now,
    lastActivityAt: now,
    ttlMs: DEFAULT_TTL_MS,
  };
  await input.kv.set(storageKey(input.tenantId, input.identityId), intent, Math.ceil(DEFAULT_TTL_MS / 1000));
  return { intent, aborted: false };
}

function mergeArgs(prior: ActiveIntent, message: string): Record<string, unknown> {
  return { ...prior.args, ...extractArgsFromMessage(message, undefined) };
}

function extractArgsFromMessage(
  message: string,
  action?: ActionDefinition,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!action) return out;
  const schema = action.inputSchema as { properties?: Record<string, { type?: string }> };
  for (const [slot, spec] of Object.entries(schema.properties ?? {})) {
    if (spec.type === 'string') {
      const re = new RegExp(`${slot}[\\s:]+([\\w.@+-]+)`, 'i');
      const m = message.match(re);
      if (m?.[1]) out[slot] = m[1];
    }
  }
  const plan = message.match(/\b(starter|pro|business|enterprise)\b/i);
  if (plan && schema.properties?.plan) out.plan = plan[1]!.toLowerCase();
  return out;
}

export function buildIntentGuidanceBlock(intent: ActiveIntent | null, aborted: boolean): string | undefined {
  if (aborted) {
    return '\n\n## Conversational intent\nUser aborted the previous intent. Acknowledge and help with their new request.';
  }
  if (!intent) return undefined;
  const slots =
    intent.missingSlots.length > 0
      ? `Required slots still missing: ${intent.missingSlots.join(', ')}. Ask for ONE missing slot at a time. Do not call tools until all are filled.`
      : `All required slots are filled — you MUST call the **${intent.intentKey}** tool now. Do not list capabilities; execute the tool and answer from the result.`;
  return `\n\n## Active intent\nIntent: **${intent.intentKey}**\nArgs: ${JSON.stringify(intent.args)}\n${slots}`;
}

function parseIntentJson(raw: string): Partial<ActiveIntent> & { intentKey?: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]!) as Partial<ActiveIntent> & { intentKey?: string };
  } catch {
    return {};
  }
}
