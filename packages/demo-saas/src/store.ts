import { createDb, type DbConnection } from '@aelio/db';

export interface DemoAccount {
  externalUserId: string;
  plan: string;
  seats: number;
  status: string;
  apiAccess: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DemoReport {
  id: string;
  report: string;
  recipient: string;
  cadence: string;
  createdAt: Date;
}

export interface DemoShare {
  id: string;
  resource: string;
  member: string;
  access: string;
  createdAt: Date;
}

export interface DemoAccountSnapshot {
  account: DemoAccount;
  reports: DemoReport[];
  shares: DemoShare[];
  invoice: { invoiceId: string; amount: number; currency: string; status: string };
}

/** Map widget sessionId → Convox externalUserId (same as Aelio API). */
export function externalUserIdFromSession(sessionId: string): string {
  return `ext_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/** Postgres-backed mock SaaS — survives restarts; used by demo customer backend tool handlers. */
export class DemoSaasStore {
  private conn: DbConnection | null = null;

  async connect(url = process.env.DATABASE_URL): Promise<void> {
    if (!url) throw new Error('DATABASE_URL is required for DemoSaasStore');
    if (this.conn) return;
    this.conn = createDb(url);
  }

  async close(): Promise<void> {
    await this.conn?.close();
    this.conn = null;
  }

  private sql() {
    if (!this.conn) throw new Error('DemoSaasStore not connected — call connect() first');
    return this.conn.sql;
  }

  async ensureAccount(externalUserId: string): Promise<DemoAccount> {
    const sql = this.sql();
    await sql`
      INSERT INTO demo_saas_accounts (external_user_id)
      VALUES (${externalUserId})
      ON CONFLICT (external_user_id) DO NOTHING
    `;
    const rows = await sql<Array<{
      external_user_id: string;
      plan: string;
      seats: number;
      status: string;
      api_access: boolean;
      created_at: Date;
      updated_at: Date;
    }>>`
      SELECT external_user_id, plan, seats, status, api_access, created_at, updated_at
      FROM demo_saas_accounts WHERE external_user_id = ${externalUserId}
    `;
    const r = rows[0]!;
    return {
      externalUserId: r.external_user_id,
      plan: r.plan,
      seats: r.seats,
      status: r.status,
      apiAccess: r.api_access,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updatePlan(
    externalUserId: string,
    plan: string,
  ): Promise<{ previousPlan: string; plan: string; seats: number; apiAccess: boolean }> {
    const sql = this.sql();
    const acct = await this.ensureAccount(externalUserId);
    const previous = acct.plan;
    let seats = acct.seats;
    let apiAccess = acct.apiAccess;
    const normalized = plan.toLowerCase();
    if (!['starter', 'pro', 'business', 'enterprise'].includes(normalized)) {
      return { previousPlan: previous, plan: acct.plan, seats, apiAccess };
    }
    if (normalized === 'starter') {
      seats = Math.min(seats, 2);
      apiAccess = false;
    }
    await sql`
      UPDATE demo_saas_accounts
      SET plan = ${normalized}, seats = ${seats}, api_access = ${apiAccess}, updated_at = now()
      WHERE external_user_id = ${externalUserId}
    `;
    return { previousPlan: previous, plan: normalized, seats, apiAccess };
  }

  async cancelSubscription(externalUserId: string): Promise<{ status: string; effectiveAt: string }> {
    const sql = this.sql();
    await this.ensureAccount(externalUserId);
    await sql`
      UPDATE demo_saas_accounts SET status = 'cancelled', updated_at = now()
      WHERE external_user_id = ${externalUserId}
    `;
    return { status: 'cancelled', effectiveAt: '2026-07-01' };
  }

  async addReport(
    externalUserId: string,
    input: { report: string; recipient: string; cadence?: string },
  ): Promise<DemoReport & { scheduled: true }> {
    const sql = this.sql();
    await this.ensureAccount(externalUserId);
    const rows = await sql<Array<{ id: string; report: string; recipient: string; cadence: string; created_at: Date }>>`
      INSERT INTO demo_saas_reports (external_user_id, report, recipient, cadence)
      VALUES (${externalUserId}, ${input.report}, ${input.recipient}, ${input.cadence ?? 'weekly'})
      RETURNING id, report, recipient, cadence, created_at
    `;
    const r = rows[0]!;
    return {
      id: r.id,
      report: r.report,
      recipient: r.recipient,
      cadence: r.cadence,
      createdAt: r.created_at,
      scheduled: true,
    };
  }

  async deleteReport(externalUserId: string, reportId: string): Promise<boolean> {
    const sql = this.sql();
    const rows = await sql`
      DELETE FROM demo_saas_reports
      WHERE id = ${reportId}::uuid AND external_user_id = ${externalUserId}
      RETURNING id
    `;
    return rows.length > 0;
  }

  async addShare(
    externalUserId: string,
    input: { resource: string; member: string; access?: string },
  ): Promise<DemoShare & { shared: true }> {
    const sql = this.sql();
    await this.ensureAccount(externalUserId);
    const rows = await sql<Array<{ id: string; resource: string; member: string; access: string; created_at: Date }>>`
      INSERT INTO demo_saas_shares (external_user_id, resource, member, access)
      VALUES (${externalUserId}, ${input.resource}, ${input.member}, ${input.access ?? 'view'})
      RETURNING id, resource, member, access, created_at
    `;
    const r = rows[0]!;
    return {
      id: r.id,
      resource: r.resource,
      member: r.member,
      access: r.access,
      createdAt: r.created_at,
      shared: true,
    };
  }

  async revokeShare(externalUserId: string, member: string): Promise<{ revoked: boolean; member: string }> {
    const sql = this.sql();
    const rows = await sql`
      DELETE FROM demo_saas_shares
      WHERE external_user_id = ${externalUserId} AND member = ${member}
      RETURNING member
    `;
    return { revoked: rows.length > 0, member };
  }

  async resetAccount(externalUserId: string): Promise<void> {
    const sql = this.sql();
    await sql`DELETE FROM demo_saas_reports WHERE external_user_id = ${externalUserId}`;
    await sql`DELETE FROM demo_saas_shares WHERE external_user_id = ${externalUserId}`;
    await sql`
      UPDATE demo_saas_accounts
      SET plan = 'pro', seats = 5, status = 'active', api_access = true, updated_at = now()
      WHERE external_user_id = ${externalUserId}
    `;
    await this.ensureAccount(externalUserId);
  }

  async getSnapshot(externalUserId: string): Promise<DemoAccountSnapshot> {
    const sql = this.sql();
    const account = await this.ensureAccount(externalUserId);
    const reports = await sql<Array<{ id: string; report: string; recipient: string; cadence: string; created_at: Date }>>`
      SELECT id, report, recipient, cadence, created_at FROM demo_saas_reports
      WHERE external_user_id = ${externalUserId} ORDER BY created_at DESC
    `;
    const shares = await sql<Array<{ id: string; resource: string; member: string; access: string; created_at: Date }>>`
      SELECT id, resource, member, access, created_at FROM demo_saas_shares
      WHERE external_user_id = ${externalUserId} ORDER BY created_at DESC
    `;
    const amount = account.plan === 'enterprise' ? 499 : account.plan === 'business' ? 249 : account.plan === 'starter' ? 29 : 149;
    return {
      account,
      reports: reports.map((r) => ({
        id: r.id,
        report: r.report,
        recipient: r.recipient,
        cadence: r.cadence,
        createdAt: r.created_at,
      })),
      shares: shares.map((s) => ({
        id: s.id,
        resource: s.resource,
        member: s.member,
        access: s.access,
        createdAt: s.created_at,
      })),
      invoice: {
        invoiceId: `INV-${externalUserId.slice(-8).toUpperCase()}`,
        amount,
        currency: 'USD',
        status: account.status === 'cancelled' ? 'final' : 'paid',
      },
    };
  }
}
