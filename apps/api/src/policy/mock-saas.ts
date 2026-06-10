/**
 * In-process stand-in for a tenant's SaaS backend. The auth proxy routes to it
 * whenever a tenant's API base URL uses the `mock://` scheme, so the whole
 * action pipeline (tier gates → auth proxy → SaaS call → state change) runs
 * end-to-end with zero external services. Real tenants use a real base URL and
 * the proxy makes real HTTP calls instead.
 *
 * State is keyed by the end user's external id — exactly the user whose scoped
 * token the auth proxy presents. There is no master-key path.
 */

interface Account {
  externalUserId: string;
  displayName: string;
  email: string;
  plan: string;
  seats: number;
  apiAccess: boolean;
  status: 'active' | 'cancelled';
  createdAt: string;
  lastLoginAt: string;
  scheduledReports: Array<{ report: string; recipient: string; cadence: string }>;
  shares: Array<{ resource: string; member: string; access: string }>;
}

const PLANS = ['starter', 'pro', 'business', 'enterprise'];

export class MockSaaS {
  private accounts = new Map<string, Account>();

  seedUser(externalUserId: string, partial: Partial<Account> = {}): void {
    this.accounts.set(externalUserId, {
      externalUserId,
      displayName: partial.displayName ?? 'Alex Rivera',
      email: partial.email ?? `${externalUserId}@example.com`,
      plan: partial.plan ?? 'pro',
      seats: partial.seats ?? 5,
      apiAccess: partial.apiAccess ?? true,
      status: partial.status ?? 'active',
      createdAt: partial.createdAt ?? '2025-09-01T00:00:00Z',
      lastLoginAt: partial.lastLoginAt ?? new Date().toISOString(),
      scheduledReports: partial.scheduledReports ?? [],
      shares: partial.shares ?? [],
    });
  }

  private require(externalUserId: string): Account {
    let acct = this.accounts.get(externalUserId);
    if (!acct) {
      this.seedUser(externalUserId);
      acct = this.accounts.get(externalUserId)!;
    }
    return acct;
  }

  /** Identity context fetch (Layer 3). */
  userContext(externalUserId: string): Record<string, unknown> {
    const a = this.require(externalUserId);
    return {
      externalUserId: a.externalUserId,
      name: a.displayName,
      email: a.email,
      plan: a.plan,
      createdAt: a.createdAt,
      lastLogin: a.lastLoginAt,
      seats: a.seats,
      apiAccess: a.apiAccess,
      status: a.status,
    };
  }

  /**
   * Dispatch an action by key on behalf of `externalUserId`. Returns the data
   * the SaaS API would return. Unknown actions echo their args (a generic SaaS
   * passthrough), so any ingested spec is at least callable in the demo.
   */
  call(externalUserId: string, actionKey: string, args: Record<string, unknown>): unknown {
    const a = this.require(externalUserId);
    const key = actionKey.toLowerCase();

    if (key.includes('account_status') || key.includes('get_account') || key === 'get_me') {
      return {
        plan: a.plan,
        seats: a.seats,
        apiAccess: a.apiAccess,
        status: a.status,
        renewsOn: '2026-07-01',
      };
    }
    if (key.includes('update_plan') || key.includes('change_plan')) {
      const requested = String(args.plan ?? '').toLowerCase();
      const plan = PLANS.includes(requested) ? requested : a.plan;
      const previous = a.plan;
      a.plan = plan;
      if (plan === 'starter') {
        a.seats = Math.min(a.seats, 2);
        a.apiAccess = false;
      }
      return { previousPlan: previous, plan: a.plan, seats: a.seats, apiAccess: a.apiAccess };
    }
    if (key.includes('cancel') || key.includes('terminate') || key.includes('delete_account')) {
      a.status = 'cancelled';
      return { status: a.status, effectiveAt: '2026-07-01', refundIssued: false };
    }
    if (key.includes('schedule')) {
      const entry = {
        report: String(args.report ?? args.dashboard ?? 'report'),
        recipient: String(args.recipient ?? args.manager ?? 'manager'),
        cadence: String(args.cadence ?? 'weekly'),
      };
      a.scheduledReports.push(entry);
      return { scheduled: true, ...entry };
    }
    if (key.includes('share') || key.includes('invite') || key.includes('grant')) {
      const entry = {
        resource: String(args.resource ?? args.report ?? 'resource'),
        member: String(args.member ?? args.email ?? args.user ?? 'member'),
        access: String(args.access ?? 'view'),
      };
      a.shares.push(entry);
      return { shared: true, ...entry };
    }
    if (key.includes('invoice') || key.includes('billing')) {
      return { invoiceId: 'INV-2026-042', amount: 149.0, currency: 'USD', status: 'paid' };
    }
    // Generic SaaS passthrough.
    return { ok: true, action: actionKey, args };
  }
}
