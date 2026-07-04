import type {
  AelioConvox,
  FlowManifest,
  StateManifest,
  ToolDefinition,
} from '@aelio/convox-sdk';

const accounts = new Map<
  string,
  {
    plan: string;
    seats: number;
    status: string;
    reports: string[];
    shares: string[];
  }
>();

function acct(userId: string) {
  let a = accounts.get(userId);
  if (!a) {
    a = { plan: 'pro', seats: 5, status: 'active', reports: [], shares: [] };
    accounts.set(userId, a);
  }
  return a;
}

/** Rich Convox catalog for robust E2E — tools, policies, states, flows. */
export const DEMO_CATALOG_TOOLS: Array<{
  key: string;
  definition: ToolDefinition;
  expectedTier: number;
}> = [
  {
    key: 'get_account_status',
    expectedTier: 0,
    definition: {
      description: 'Get account plan, seats, and status',
      inputSchema: { type: 'object', properties: {} },
      policy: { tier: 0, exposed: true },
      handler: async (ctx) => {
        const a = acct(ctx.externalUserId);
        return { plan: a.plan, seats: a.seats, status: a.status };
      },
    },
  },
  {
    key: 'get_invoice',
    expectedTier: 0,
    definition: {
      description: 'Get latest invoice summary',
      inputSchema: { type: 'object', properties: {} },
      policy: { tier: 0 },
      handler: async () => ({ invoiceId: 'INV-E2E', amount: 149, currency: 'USD', status: 'paid' }),
    },
  },
  {
    key: 'list_team_members',
    expectedTier: 0,
    definition: {
      description: 'List team members on the account',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ members: ['alex@acme.com', 'sam@acme.com'] }),
    },
  },
  {
    key: 'schedule_report',
    expectedTier: 1,
    definition: {
      description: 'Schedule a recurring report',
      inputSchema: {
        type: 'object',
        properties: { report: { type: 'string' }, recipient: { type: 'string' } },
        required: ['report', 'recipient'],
      },
      policy: { tier: 1, confirmationCopy: 'Schedule this report?' },
      handler: async (ctx, args) => {
        const a = acct(ctx.externalUserId);
        const entry = `${String(args.report)}→${String(args.recipient)}`;
        a.reports.push(entry);
        return { scheduled: true, report: args.report, recipient: args.recipient };
      },
    },
  },
  {
    key: 'share_resource',
    expectedTier: 1,
    definition: {
      description: 'Share a dashboard with a teammate',
      inputSchema: {
        type: 'object',
        properties: { resource: { type: 'string' }, member: { type: 'string' } },
        required: ['resource', 'member'],
      },
      policy: { tier: 1 },
      handler: async (ctx, args) => {
        const a = acct(ctx.externalUserId);
        const entry = `${String(args.resource)}→${String(args.member)}`;
        a.shares.push(entry);
        return { shared: true, ...args };
      },
    },
  },
  {
    key: 'update_plan',
    expectedTier: 2,
    definition: {
      description: 'Change subscription plan',
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string' } },
        required: ['plan'],
      },
      policy: { tier: 2, confirmationCopy: 'Confirm plan change?' },
      handler: async (ctx, args) => {
        const a = acct(ctx.externalUserId);
        const prev = a.plan;
        a.plan = String(args.plan).toLowerCase();
        return { previousPlan: prev, plan: a.plan };
      },
    },
  },
  {
    key: 'cancel_subscription',
    expectedTier: 3,
    definition: {
      description: 'Cancel subscription at period end',
      inputSchema: { type: 'object', properties: {} },
      policy: {
        tier: 3,
        stepUpRequired: true,
        rateLimitPerUserPerHour: 3,
        confirmationCopy: 'This will cancel your subscription. Continue?',
      },
      handler: async (ctx) => {
        const a = acct(ctx.externalUserId);
        a.status = 'cancelled';
        return { status: a.status, userId: ctx.externalUserId };
      },
    },
  },
  {
    key: 'revoke_access',
    expectedTier: 3,
    definition: {
      description: 'Revoke a team member access',
      inputSchema: {
        type: 'object',
        properties: { member: { type: 'string' } },
        required: ['member'],
      },
      policy: { tier: 3, stepUpRequired: true },
      handler: async (_ctx, args) => ({ revoked: true, member: args.member }),
    },
  },
];

export const DEMO_CATALOG_STATES: StateManifest[] = [
  {
    key: 'onboarding',
    description: 'New customer setup',
    guidance: 'Help pick a plan, invite a teammate, schedule first report.',
    signals: 'new, setup, onboarding, first time',
    tools: ['get_account_status', 'update_plan', 'share_resource', 'schedule_report'],
    objectives: [
      { key: 'choose_plan', description: 'Select a plan', satisfiedByTool: 'update_plan' },
      { key: 'invite_teammate', description: 'Share with teammate', satisfiedByTool: 'share_resource' },
    ],
  },
  {
    key: 'active',
    description: 'Day-to-day usage',
    guidance: 'Answer billing and usage questions efficiently.',
    signals: 'plan, invoice, usage, help',
    tools: ['get_account_status', 'get_invoice', 'list_team_members', 'update_plan'],
    objectives: [],
  },
  {
    key: 'churn',
    description: 'Cancellation risk',
    guidance: 'Listen empathetically; offer retention before cancel.',
    signals: 'cancel, churn, expensive, leave',
    tools: ['get_account_status', 'update_plan', 'cancel_subscription'],
    objectives: [
      { key: 'understand_reason', description: 'Learn why they want to leave' },
      { key: 'offer_retention', description: 'Offer alternative plan', satisfiedByTool: 'update_plan' },
    ],
  },
  {
    key: 'support_escalation',
    description: 'Complex support issue',
    guidance: 'Gather details; use read tools; escalate if blocked.',
    signals: 'bug, broken, not working, escalate',
    tools: ['get_account_status', 'list_team_members'],
    objectives: [{ key: 'capture_issue', description: 'Document the issue' }],
  },
];

export const DEMO_CATALOG_FLOWS: FlowManifest[] = [
  {
    stateKey: 'onboarding',
    objectiveKey: 'choose_plan',
    approved: true,
    steps: [
      { order: 1, prompt: 'Ask team size and usage needs.' },
      { order: 2, toolKey: 'get_account_status' },
      { order: 3, toolKey: 'update_plan' },
      { order: 4, prompt: 'Confirm plan and next steps.' },
    ],
  },
  {
    stateKey: 'churn',
    objectiveKey: 'offer_retention',
    approved: true,
    steps: [
      { order: 1, prompt: 'Acknowledge intent and ask root cause.' },
      { order: 2, toolKey: 'get_account_status' },
      { order: 3, toolKey: 'update_plan' },
      { order: 4, prompt: 'Summarize retention offer.' },
    ],
  },
  {
    stateKey: 'support_escalation',
    objectiveKey: 'capture_issue',
    approved: true,
    steps: [
      { order: 1, prompt: 'Ask for error details and reproduction steps.' },
      { order: 2, toolKey: 'list_team_members' },
      { order: 3, prompt: 'Confirm escalation path.' },
    ],
  },
];

/** Register the full demo catalog on a Convox SDK instance. */
export function registerDemoCatalog(convox: AelioConvox): void {
  for (const t of DEMO_CATALOG_TOOLS) convox.tool(t.key, t.definition);
  for (const s of DEMO_CATALOG_STATES) {
    const { key, ...manifest } = s;
    convox.state(key, manifest);
  }
  for (const f of DEMO_CATALOG_FLOWS) convox.flow(f);
}

export function resetDemoAccounts(): void {
  accounts.clear();
}