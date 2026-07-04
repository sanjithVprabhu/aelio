/** Phrase → tool routing used when the LLM intent classifier returns general. */
export interface IntentRoute {
  toolKey: string;
  phrases: string[];
  extractArgs?: (message: string) => Record<string, unknown>;
}

export const INTENT_ROUTES: IntentRoute[] = [
  {
    toolKey: 'list_team_members',
    phrases: [
      'list team',
      'list the team',
      'team members',
      'list members',
      'who is on my team',
      "who's on my team",
      'show team',
      'my team members',
      'who has access',
    ],
  },
  {
    toolKey: 'get_account_status',
    phrases: [
      "what's my plan",
      'what is my plan',
      'my plan',
      'account status',
      'check my account',
      'get account',
      'show account',
      'my account',
      'how many seats',
    ],
  },
  {
    toolKey: 'get_invoice',
    phrases: ['invoice', 'latest bill', 'receipt', 'billing', 'what do i owe'],
  },
  {
    toolKey: 'schedule_report',
    phrases: ['schedule', 'weekly report', 'recurring report', 'send me a report'],
  },
  {
    toolKey: 'share_resource',
    phrases: ['share', 'give access', 'invite', 'add teammate'],
  },
  {
    toolKey: 'update_plan',
    phrases: ['downgrade', 'upgrade', 'change plan', 'switch to', 'change my plan'],
    extractArgs: (m) => {
      const plan = /\b(starter|pro|business|enterprise)\b/i.exec(m);
      return plan ? { plan: plan[1]!.toLowerCase() } : {};
    },
  },
  {
    toolKey: 'cancel_subscription',
    phrases: ['cancel subscription', 'cancel my', 'unsubscribe', 'end my subscription'],
  },
  {
    toolKey: 'revoke_access',
    phrases: ['revoke access', 'remove access', 'revoke'],
  },
];

export function matchDeterministicIntent(
  message: string,
  availableToolKeys: Iterable<string>,
): { toolKey: string; args: Record<string, unknown> } | null {
  const allowed = new Set(availableToolKeys);
  const lower = message.trim().toLowerCase();
  for (const route of INTENT_ROUTES) {
    if (!allowed.has(route.toolKey)) continue;
    if (!route.phrases.some((p) => lower.includes(p))) continue;
    return { toolKey: route.toolKey, args: route.extractArgs?.(message) ?? {} };
  }
  return null;
}