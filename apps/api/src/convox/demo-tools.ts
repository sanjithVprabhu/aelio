import { ActionTier } from '@aelio/types';
import type { ToolManifest } from '@aelio/convox-sdk';
import type { InProcessHandler } from './registry.js';

/** Demo Convox tools used by tests and the local harness until a customer app connects. */
export const DEMO_TOOL_MANIFESTS: ToolManifest[] = [
  {
    key: 'get_account_status',
    description: 'Get the current account status, plan, seats and renewal date',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    key: 'update_plan',
    description: 'Change the account plan',
    inputSchema: {
      type: 'object',
      properties: { plan: { type: 'string', description: 'Target plan' } },
      required: ['plan'],
    },
  },
  {
    key: 'cancel_subscription',
    description: 'Cancel the subscription at the end of the current period',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    key: 'schedule_report',
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
  },
  {
    key: 'share_resource',
    description: 'Share a resource with a team member',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string' },
        member: { type: 'string' },
        access: { type: 'string' },
      },
      required: ['resource', 'member'],
    },
  },
  {
    key: 'get_invoice',
    description: 'Get the latest invoice',
    inputSchema: { type: 'object', properties: {} },
  },
];

interface DemoAccount {
  plan: string;
  seats: number;
  apiAccess: boolean;
  status: string;
  scheduledReports: Array<{ report: string; recipient: string; cadence: string }>;
  shares: Array<{ resource: string; member: string; access: string }>;
}

const accounts = new Map<string, DemoAccount>();

function account(userId: string): DemoAccount {
  let a = accounts.get(userId);
  if (!a) {
    a = {
      plan: 'pro',
      seats: 5,
      apiAccess: true,
      status: 'active',
      scheduledReports: [],
      shares: [],
    };
    accounts.set(userId, a);
  }
  return a;
}

export function buildDemoHandlers(): Record<string, InProcessHandler> {
  return {
    get_account_status: async (ctx) => {
      const a = account(ctx.externalUserId);
      return { plan: a.plan, seats: a.seats, apiAccess: a.apiAccess, status: a.status };
    },
    update_plan: async (ctx, args) => {
      const a = account(ctx.externalUserId);
      const requested = String(args.plan ?? '').toLowerCase();
      const previous = a.plan;
      if (['starter', 'pro', 'business', 'enterprise'].includes(requested)) a.plan = requested;
      if (a.plan === 'starter') {
        a.seats = Math.min(a.seats, 2);
        a.apiAccess = false;
      }
      return { previousPlan: previous, plan: a.plan, seats: a.seats, apiAccess: a.apiAccess };
    },
    cancel_subscription: async (ctx) => {
      const a = account(ctx.externalUserId);
      a.status = 'cancelled';
      return { status: a.status, effectiveAt: '2026-07-01', refundIssued: false };
    },
    schedule_report: async (ctx, args) => {
      const a = account(ctx.externalUserId);
      const entry = {
        report: String(args.report ?? 'report'),
        recipient: String(args.recipient ?? 'manager'),
        cadence: String(args.cadence ?? 'weekly'),
      };
      a.scheduledReports.push(entry);
      return { scheduled: true, ...entry };
    },
    share_resource: async (ctx, args) => {
      const a = account(ctx.externalUserId);
      const entry = {
        resource: String(args.resource ?? 'resource'),
        member: String(args.member ?? 'member'),
        access: String(args.access ?? 'view'),
      };
      a.shares.push(entry);
      return { shared: true, ...entry };
    },
    get_invoice: async () => ({
      invoiceId: 'INV-2026-042',
      amount: 149.0,
      currency: 'USD',
      status: 'paid',
    }),
  };
}

export function demoToolTiers(): Record<string, ActionTier> {
  return {
    get_account_status: ActionTier.Read,
    get_invoice: ActionTier.Read,
    share_resource: ActionTier.ReversibleWrite,
    schedule_report: ActionTier.StateUpdate,
    update_plan: ActionTier.StateUpdate,
    cancel_subscription: ActionTier.Destructive,
  };
}

/** @internal Test helper — reset demo account state. */
export function resetDemoAccount(userId: string): void {
  accounts.delete(userId);
}