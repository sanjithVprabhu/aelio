import type { DbConnection } from '@aelio/db';
import type { FlowDefinition, FlowStep } from './flow-engine.js';
import { DEMO_FLOWS } from './demo-flows.js';
import { uuid } from '../util/id.js';

export interface FlowRecord extends FlowDefinition {
  tenantId: string;
  approved: boolean;
}

function parseSteps(raw: unknown): FlowStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: FlowStep[] = [];
  for (const s of raw) {
    const step = s as Record<string, unknown>;
    const order = Number(step.order);
    if (!Number.isFinite(order)) continue;
    const parsed: FlowStep = { order };
    if (typeof step.toolKey === 'string') parsed.toolKey = step.toolKey;
    if (typeof step.prompt === 'string') parsed.prompt = step.prompt;
    steps.push(parsed);
  }
  return steps.sort((a, b) => a.order - b.order);
}

/** Load approved objective flows from Postgres (falls back to demo flows in memory mode). */
export class FlowStore {
  constructor(private readonly sql?: DbConnection['sql']) {}

  get canPersist(): boolean {
    return !!this.sql;
  }

  /** Synchronous fallback for in-memory containers. */
  defaultFlows(): FlowDefinition[] {
    return DEMO_FLOWS;
  }

  async listApproved(tenantId: string): Promise<FlowDefinition[]> {
    if (!this.sql) return DEMO_FLOWS;
    const rows = await this.sql<
      Array<{
        id: string;
        objective_key: string;
        state_key: string;
        steps: unknown;
      }>
    >`
      SELECT id, objective_key, state_key, steps
      FROM convox_flows
      WHERE tenant_id = ${tenantId} AND approved = true
      ORDER BY state_key, objective_key
    `;
    if (rows.length === 0) return DEMO_FLOWS;
    return rows.map((r) => ({
      id: r.id,
      objectiveKey: r.objective_key,
      stateKey: r.state_key,
      steps: parseSteps(r.steps),
    }));
  }

  async listAll(tenantId: string): Promise<FlowRecord[]> {
    if (!this.sql) {
      return DEMO_FLOWS.map((f) => ({ ...f, tenantId, approved: true }));
    }
    const rows = await this.sql<
      Array<{
        id: string;
        objective_key: string;
        state_key: string;
        steps: unknown;
        approved: boolean;
      }>
    >`
      SELECT id, objective_key, state_key, steps, approved
      FROM convox_flows
      WHERE tenant_id = ${tenantId}
      ORDER BY state_key, objective_key
    `;
    return rows.map((r) => ({
      id: r.id,
      tenantId,
      objectiveKey: r.objective_key,
      stateKey: r.state_key,
      steps: parseSteps(r.steps),
      approved: r.approved,
    }));
  }

  async upsert(
    tenantId: string,
    input: {
      id?: string;
      objectiveKey: string;
      stateKey: string;
      steps: FlowStep[];
      approved?: boolean;
    },
  ): Promise<FlowRecord> {
    if (!this.sql) throw new Error('FlowStore requires DATABASE_URL');
    const id = input.id ?? uuid();
    const approved = input.approved ?? false;
    await this.sql`
      INSERT INTO convox_flows (id, tenant_id, objective_key, state_key, steps, approved)
      VALUES (${id}, ${tenantId}, ${input.objectiveKey}, ${input.stateKey}, ${JSON.stringify(input.steps)}::jsonb, ${approved})
      ON CONFLICT (tenant_id, state_key, objective_key) DO UPDATE SET
        steps = EXCLUDED.steps,
        approved = EXCLUDED.approved,
        updated_at = now()
    `;
    return {
      id,
      tenantId,
      objectiveKey: input.objectiveKey,
      stateKey: input.stateKey,
      steps: input.steps,
      approved,
    };
  }

  async seedDemoFlows(tenantId: string): Promise<void> {
    if (!this.sql) return;
    for (const flow of DEMO_FLOWS) {
      await this.upsert(tenantId, {
        objectiveKey: flow.objectiveKey,
        stateKey: flow.stateKey,
        steps: flow.steps,
        approved: true,
      });
    }
  }

  async remove(tenantId: string, stateKey: string, objectiveKey: string): Promise<void> {
    if (!this.sql) return;
    await this.sql`
      DELETE FROM convox_flows
      WHERE tenant_id = ${tenantId} AND state_key = ${stateKey} AND objective_key = ${objectiveKey}
    `;
  }
}