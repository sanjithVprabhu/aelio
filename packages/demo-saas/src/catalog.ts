import type { AelioConvox, FlowManifest, StateManifest } from '@aelio/convox-sdk';
import type { DemoSaasStore } from './store.js';

export const DEMO_SAAS_STATES: StateManifest[] = [
  {
    key: 'onboarding',
    description: 'New customer setup',
    guidance: 'Help pick a plan, invite a teammate, schedule first report.',
    signals: 'new, setup, onboarding, first time, just signed up',
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
    signals: 'plan, invoice, usage, help, account',
    tools: ['get_account_status', 'get_invoice', 'list_team_members', 'update_plan'],
    objectives: [],
  },
  {
    key: 'churn',
    description: 'Cancellation risk',
    guidance: 'Listen empathetically; offer retention before cancel.',
    signals: 'cancel, churn, expensive, leave, unsubscribe',
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
    signals: 'bug, broken, not working, escalate, error',
    tools: ['get_account_status', 'list_team_members'],
    objectives: [{ key: 'capture_issue', description: 'Document the issue' }],
  },
];

export const DEMO_SAAS_FLOWS: FlowManifest[] = [
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

/** Register demo SaaS states on a Convox SDK client. */
export function registerDemoSaasStates(convox: Pick<AelioConvox, 'state'>): void {
  for (const { key, ...manifest } of DEMO_SAAS_STATES) {
    convox.state(key, manifest);
  }
}

/** Register demo SaaS flows on a Convox SDK client. */
export function registerDemoSaasFlows(convox: Pick<AelioConvox, 'flow'>): void {
  for (const flow of DEMO_SAAS_FLOWS) {
    convox.flow(flow);
  }
}

/** Register Postgres-backed tools, states, flows on a Convox SDK client. */
export function registerDemoSaasCatalog(convox: AelioConvox, store: DemoSaasStore): void {
  convox.tool('get_account_status', {
    description: 'Get account plan, seats, status, and API access',
    inputSchema: { type: 'object', properties: {} },
    policy: { tier: 0, exposed: true },
    handler: async (ctx) => {
      const snap = await store.getSnapshot(ctx.externalUserId);
      return {
        plan: snap.account.plan,
        seats: snap.account.seats,
        status: snap.account.status,
        apiAccess: snap.account.apiAccess,
        reportCount: snap.reports.length,
        shareCount: snap.shares.length,
      };
    },
  });

  convox.tool('get_invoice', {
    description: 'Get latest invoice summary',
    inputSchema: { type: 'object', properties: {} },
    policy: { tier: 0 },
    handler: async (ctx) => {
      const snap = await store.getSnapshot(ctx.externalUserId);
      return snap.invoice;
    },
  });

  convox.tool('list_team_members', {
    description: 'List team members with shared access',
    inputSchema: { type: 'object', properties: {} },
    handler: async (ctx) => {
      const snap = await store.getSnapshot(ctx.externalUserId);
      const members = [
        'alex@acme.com',
        'sam@acme.com',
        ...snap.shares.map((s) => s.member),
      ];
      return { members: [...new Set(members)] };
    },
  });

  convox.tool('schedule_report', {
    description: 'Schedule a recurring report to a recipient',
    inputSchema: {
      type: 'object',
      properties: {
        report: { type: 'string' },
        recipient: { type: 'string' },
        cadence: { type: 'string' },
      },
      required: ['report', 'recipient'],
    },
    policy: { tier: 1, confirmationCopy: 'Schedule this recurring report?' },
    handler: async (ctx, args) =>
      store.addReport(ctx.externalUserId, {
        report: String(args.report ?? 'report'),
        recipient: String(args.recipient ?? 'manager'),
        cadence: String(args.cadence ?? 'weekly'),
      }),
  });

  convox.tool('share_resource', {
    description: 'Share a dashboard or resource with a teammate',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string' },
        member: { type: 'string' },
        access: { type: 'string' },
      },
      required: ['resource', 'member'],
    },
    policy: { tier: 1 },
    handler: async (ctx, args) =>
      store.addShare(ctx.externalUserId, {
        resource: String(args.resource ?? 'dashboard'),
        member: String(args.member ?? 'teammate'),
        access: String(args.access ?? 'view'),
      }),
  });

  convox.tool('update_plan', {
    description: 'Change subscription plan (starter, pro, business, enterprise)',
    inputSchema: {
      type: 'object',
      properties: { plan: { type: 'string' } },
      required: ['plan'],
    },
    policy: { tier: 2, confirmationCopy: 'Confirm plan change?' },
    handler: async (ctx, args) => store.updatePlan(ctx.externalUserId, String(args.plan ?? '')),
  });

  convox.tool('cancel_subscription', {
    description: 'Cancel subscription at end of billing period',
    inputSchema: { type: 'object', properties: {} },
    policy: {
      tier: 3,
      stepUpRequired: true,
      rateLimitPerUserPerHour: 3,
      confirmationCopy: 'This will cancel your subscription. Continue?',
    },
    handler: async (ctx) => {
      const result = await store.cancelSubscription(ctx.externalUserId);
      return { ...result, userId: ctx.externalUserId };
    },
  });

  convox.tool('revoke_access', {
    description: 'Revoke a team member shared access',
    inputSchema: {
      type: 'object',
      properties: { member: { type: 'string' } },
      required: ['member'],
    },
    policy: { tier: 3, stepUpRequired: true },
    handler: async (ctx, args) =>
      store.revokeShare(ctx.externalUserId, String(args.member ?? '')),
  });

  registerDemoSaasStates(convox);
  registerDemoSaasFlows(convox);
}
