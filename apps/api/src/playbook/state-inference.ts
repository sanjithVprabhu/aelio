import type { ActionInvocation, Playbook, UserContext } from '@aelio/types';

export interface StateSignal {
  source: 'conversation' | 'action_history' | 'saas_context';
  signal: string;
  weight: number;
  pointsTo: string;
}

export interface StateInferenceInput {
  currentState: string;
  currentConfidence: number;
  verified: boolean;
  userContext?: UserContext;
  recentUserMessages: string[];
  actionHistory: ActionInvocation[];
}

export interface StateInferenceResult {
  state: string;
  confidence: number;
  changed: boolean;
  signals: StateSignal[];
}

const UPDATE_THRESHOLD = 0.65;

const CONVERSATION_SIGNALS: Array<{ phrases: string[]; pointsTo: string; weight: number }> = [
  { phrases: ['cancel', 'refund', 'downgrade', 'angry', 'frustrated', 'unhappy', 'leave'], pointsTo: 'at_risk', weight: 0.45 },
  { phrases: ['how do i', 'getting started', 'set up', 'confused', 'stuck', 'where is'], pointsTo: 'early_user', weight: 0.35 },
  { phrases: ['api', 'automation', 'advanced', 'integrate', 'webhook', 'bulk'], pointsTo: 'power_user', weight: 0.3 },
];

function daysSince(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  return (Date.now() - t) / (24 * 3600 * 1000);
}

/** Map a canonical inferred state to the nearest key the playbook defines. */
function nearestPlaybookState(playbook: Playbook, canonical: string): string {
  const keys = playbook.lifecycle.states.map((s) => s.key);
  if (keys.includes(canonical)) return canonical;
  const aliases: Record<string, string[]> = {
    early_user: ['onboarding', 'verified', 'new_user', 'discovery'],
    power_user: ['poweruser', 'activation', 'active'],
    at_risk: ['churning', 'retention'],
    active: ['verified', 'engaged'],
    unverified: ['unverified'],
  };
  for (const alt of aliases[canonical] ?? []) {
    if (keys.includes(alt)) return alt;
  }
  return playbook.lifecycle.defaultState;
}

export function inferState(input: StateInferenceInput, playbook: Playbook): StateInferenceResult {
  const signals: StateSignal[] = [];

  if (!input.verified) {
    signals.push({ source: 'saas_context', signal: 'not verified', weight: 0.9, pointsTo: 'unverified' });
  }

  // Conversation signals (keyword classifier; a production build uses an LLM).
  const text = input.recentUserMessages.join(' ').toLowerCase();
  for (const rule of CONVERSATION_SIGNALS) {
    if (rule.phrases.some((p) => text.includes(p))) {
      signals.push({ source: 'conversation', signal: rule.phrases[0]!, weight: rule.weight, pointsTo: rule.pointsTo });
    }
  }

  // Action-history signals (deterministic).
  const recent = input.actionHistory.slice(0, 20);
  const cancels = recent.filter((a) => /cancel|terminate|delete/.test(a.actionKey)).length;
  const fails = recent.filter((a) => a.status === 'failed').length;
  const upgrades = recent.filter((a) => /upgrade|update_plan/.test(a.actionKey)).length;
  if (cancels >= 2) signals.push({ source: 'action_history', signal: '2+ cancellations', weight: 0.4, pointsTo: 'at_risk' });
  if (fails >= 3) signals.push({ source: 'action_history', signal: '3+ failed actions', weight: 0.2, pointsTo: 'at_risk' });
  if (upgrades >= 1) signals.push({ source: 'action_history', signal: 'upgrade action', weight: 0.3, pointsTo: 'power_user' });

  // SaaS-context signals.
  if (input.verified && input.userContext) {
    const age = daysSince(input.userContext.accountCreatedAt);
    const sinceLogin = daysSince(input.userContext.lastLoginAt);
    if (age !== undefined && age < 14) signals.push({ source: 'saas_context', signal: 'account < 14d', weight: 0.5, pointsTo: 'early_user' });
    if (sinceLogin !== undefined && sinceLogin > 30) signals.push({ source: 'saas_context', signal: 'login > 30d', weight: 0.45, pointsTo: 'at_risk' });
  }

  // Sum weights per state; default toward `active` when verified with no signal.
  const scores = new Map<string, number>();
  for (const s of signals) scores.set(s.pointsTo, (scores.get(s.pointsTo) ?? 0) + s.weight);
  if (input.verified && scores.size === 0) scores.set('active', 0.7);

  let bestState = input.currentState;
  let bestScore = 0;
  for (const [state, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestState = state;
    }
  }

  const confidence = Math.min(1, bestScore);
  const mapped = nearestPlaybookState(playbook, bestState);
  const shouldUpdate =
    confidence >= UPDATE_THRESHOLD &&
    (mapped !== input.currentState || confidence - input.currentConfidence > 0.1);

  return {
    state: shouldUpdate ? mapped : input.currentState,
    confidence: shouldUpdate ? confidence : input.currentConfidence,
    changed: shouldUpdate && mapped !== input.currentState,
    signals,
  };
}
