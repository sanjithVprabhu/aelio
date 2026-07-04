import type { StateManifest } from '@aelio/convox-sdk';
import type { DbConnection } from '@aelio/db';
import type { ConvoxRegistry } from './registry.js';

/** Persist Convox state manifests to Postgres and hydrate the registry on boot. */
export class ConvoxStateBridge {
  constructor(
    private readonly sql: DbConnection['sql'] | undefined,
    private readonly registry: ConvoxRegistry,
  ) {}

  /** Upsert all live states for a tenant into durable storage. */
  async syncFromRegistry(tenantId: string): Promise<void> {
    if (!this.sql) return;
    const states = this.registry.listStates(tenantId);
    const liveKeys = new Set(states.map((state) => state.key));
    const hasConnection = this.registry.listConnections(tenantId).length > 0;
    for (const state of states) {
      await this.upsert(tenantId, state);
    }
    if (!hasConnection) return;
    const rows = await this.sql<Array<{ state_key: string }>>`
      SELECT state_key FROM convox_state_catalog WHERE tenant_id = ${tenantId}
    `;
    for (const row of rows) {
      if (liveKeys.has(row.state_key)) continue;
      await this.remove(tenantId, row.state_key);
    }
  }

  async upsert(tenantId: string, manifest: StateManifest, instanceId?: string): Promise<void> {
    if (!this.sql) return;
    await this.sql`
      INSERT INTO convox_state_catalog (tenant_id, state_key, manifest, instance_id, updated_at)
      VALUES (${tenantId}, ${manifest.key}, ${JSON.stringify(manifest)}::jsonb, ${instanceId ?? null}, now())
      ON CONFLICT (tenant_id, state_key)
      DO UPDATE SET manifest = EXCLUDED.manifest, instance_id = EXCLUDED.instance_id, updated_at = now()
    `;
  }

  async remove(tenantId: string, key: string): Promise<void> {
    if (!this.sql) return;
    await this.sql`
      DELETE FROM convox_state_catalog WHERE tenant_id = ${tenantId} AND state_key = ${key}
    `;
  }

  /** Load disk catalog into the registry (merged with live connections at read time). */
  async hydrate(tenantId: string): Promise<void> {
    if (!this.sql) return;
    const rows = await this.sql<Array<{ manifest: StateManifest }>>`
      SELECT manifest FROM convox_state_catalog WHERE tenant_id = ${tenantId}
    `;
    if (rows.length) {
      this.registry.registerDiskStates(
        tenantId,
        rows.map((r) => r.manifest),
      );
    }
  }

  async hydrateAll(tenantIds: string[]): Promise<void> {
    for (const id of tenantIds) await this.hydrate(id);
  }
}
