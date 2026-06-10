import type {
  ActionInvocation,
  PlaybookTrigger,
  TriggerCondition,
  TriggerEvent,
} from '@aelio/types';

export interface TriggerContext {
  event: TriggerEvent;
  message: string;
  currentState: string;
  actionHistory: ActionInvocation[];
}

export interface TriggerFired {
  triggerId: string;
  label: string;
  action: PlaybookTrigger['action'];
}

function eventMatches(a: TriggerEvent, b: TriggerEvent): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'action_succeeded' && b.type === 'action_succeeded') return a.actionKey === b.actionKey;
  if (a.type === 'action_failed' && b.type === 'action_failed') return a.actionKey === b.actionKey;
  if (a.type === 'state_entered' && b.type === 'state_entered') return a.state === b.state;
  return true;
}

function evalCondition(cond: TriggerCondition, ctx: TriggerContext): boolean {
  switch (cond.type) {
    case 'message_contains': {
      const text = ctx.message.toLowerCase();
      const hits = cond.phrases.map((p) => text.includes(p.toLowerCase()));
      return cond.matchType === 'all' ? hits.every(Boolean) : hits.some(Boolean);
    }
    case 'message_intent':
      // Without an intent classifier, treat the intent word as a substring match.
      return ctx.message.toLowerCase().includes(cond.intent.toLowerCase());
    case 'state_is':
      return ctx.currentState === cond.state;
    case 'action_count': {
      const count = ctx.actionHistory.filter((a) => a.actionKey === cond.actionKey).length;
      return cond.operator === '>=' ? count >= cond.count : count <= cond.count;
    }
    case 'consecutive_failures': {
      let streak = 0;
      for (const a of ctx.actionHistory) {
        if (a.status === 'failed') streak++;
        else break;
      }
      return streak >= cond.count;
    }
    case 'and':
      return cond.conditions.every((c) => evalCondition(c, ctx));
    case 'or':
      return cond.conditions.some((c) => evalCondition(c, ctx));
  }
}

/** Evaluate every enabled trigger; return those whose event + condition match. */
export function evaluateTriggers(triggers: PlaybookTrigger[], ctx: TriggerContext): TriggerFired[] {
  const fired: TriggerFired[] = [];
  for (const t of triggers) {
    if (!t.enabled) continue;
    if (!eventMatches(t.event, ctx.event)) continue;
    if (!evalCondition(t.condition, ctx)) continue;
    fired.push({ triggerId: t.id, label: t.label, action: t.action });
  }
  return fired;
}
