import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { createDb, runMigrations, schema, type DbConnection } from '@aelio/db';
import { createLogger } from '@aelio/logger';
import type { Persistence, PersistKind, StoreSnapshot } from './persistence.js';
import type { Store } from './store.js';

const log = createLogger({});

interface TableSpec {
  table: PgTable;
  pk: PgColumn;
  append?: boolean;
}

const TABLES: Record<PersistKind, TableSpec> = {
  tenants: { table: schema.tenants, pk: schema.tenants.id },
  admin_users: { table: schema.adminUsers, pk: schema.adminUsers.id },
  channels: { table: schema.channels, pk: schema.channels.id },
  identities: { table: schema.endUserIdentities, pk: schema.endUserIdentities.id },
  identity_channels: { table: schema.identityChannels, pk: schema.identityChannels.id },
  conversations: { table: schema.conversations, pk: schema.conversations.id },
  turns: { table: schema.turns, pk: schema.turns.id, append: true },
  playbooks: { table: schema.playbooks, pk: schema.playbooks.id },
  specs: { table: schema.apiSpecs, pk: schema.apiSpecs.id },
  actions: { table: schema.actionDefinitions, pk: schema.actionDefinitions.id },
  invocations: { table: schema.actionInvocations, pk: schema.actionInvocations.id, append: true },
  escalations: { table: schema.escalations, pk: schema.escalations.id },
  audit: { table: schema.auditEvents, pk: schema.auditEvents.id, append: true },
  onboarding: { table: schema.onboardingStates, pk: schema.onboardingStates.tenantId },
  kb_collections: { table: schema.kbCollections, pk: schema.kbCollections.id },
  kb_sources: { table: schema.kbSources, pk: schema.kbSources.id },
  kb_chunks: { table: schema.kbChunks, pk: schema.kbChunks.id },
  eval_suites: { table: schema.evalSuites, pk: schema.evalSuites.id },
  eval_scenarios: { table: schema.evalScenarios, pk: schema.evalScenarios.id },
  eval_runs: { table: schema.evalRuns, pk: schema.evalRuns.id },
  long_term: { table: schema.longTermMemory, pk: schema.longTermMemory.id },
};

/** Pick only the columns the table defines from a domain object (drops e.g. identity.channels). */
function pickColumns(table: PgTable, row: Record<string, unknown>): Record<string, unknown> {
  const cols = getTableColumns(table);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(cols)) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

// The Playbook domain keeps lifecycle/triggers/fallbackLadder/messageTemplates at
// the top level; the schema stores them in a single `config` jsonb column.
function playbookToRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    config: {
      lifecycle: row.lifecycle,
      triggers: row.triggers,
      fallbackLadder: row.fallbackLadder,
      messageTemplates: row.messageTemplates,
    },
  };
}
function playbookFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const config = (row.config ?? {}) as Record<string, unknown>;
  return { ...row, ...config };
}

/**
 * Postgres-backed durable mirror. The in-memory Store is the working set; this
 * writes every mutation through (serialized, fire-and-forget) and hydrates the
 * working set from Postgres on boot — the production persistence path against
 * the Drizzle schema in packages/db.
 */
export class DrizzlePersistence implements Persistence {
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(private readonly conn: DbConnection) {}

  static async connect(url: string): Promise<DrizzlePersistence> {
    const conn = createDb(url);
    const applied = await runMigrations(conn);
    if (applied.length) log.info({ applied }, 'db migrations applied');
    return new DrizzlePersistence(conn);
  }

  private enqueue(op: () => Promise<unknown>): void {
    this.chain = this.chain.then(op).catch((err) => log.error({ err }, 'persistence write failed'));
  }

  upsert(kind: PersistKind, row: Record<string, unknown>): void {
    const spec = TABLES[kind];
    const prepared = kind === 'playbooks' ? playbookToRow(row) : row;
    const values = pickColumns(spec.table, prepared);
    this.enqueue(async () => {
      const ins = this.conn.db.insert(spec.table).values(values as never);
      if (spec.append) {
        await ins.onConflictDoNothing({ target: spec.pk });
      } else {
        await ins.onConflictDoUpdate({ target: spec.pk, set: values as never });
      }
    });
  }

  remove(kind: PersistKind, id: string): void {
    this.enqueue(async () => {
      if (kind === 'kb_chunks') {
        // `id` is the sourceId for chunk deletes.
        await this.conn.sql`DELETE FROM kb_chunks WHERE source_id = ${id}`;
      } else if (kind === 'onboarding') {
        await this.conn.sql`DELETE FROM onboarding_states WHERE tenant_id = ${id}`;
      } else {
        const table = TABLES[kind].table;
        const name = getTableName(table);
        await this.conn.sql`DELETE FROM ${this.conn.sql(name)} WHERE id = ${id}`;
      }
    });
  }

  eraseIdentity(_tenantId: string, identityId: string): void {
    this.enqueue(async () => {
      const s = this.conn.sql;
      await s`DELETE FROM turns WHERE conversation_id IN (SELECT id FROM conversations WHERE identity_id = ${identityId})`;
      await s`DELETE FROM conversations WHERE identity_id = ${identityId}`;
      await s`DELETE FROM identity_channels WHERE identity_id = ${identityId}`;
      await s`DELETE FROM long_term_memory WHERE identity_id = ${identityId}`;
      await s`DELETE FROM end_user_identities WHERE id = ${identityId}`;
    });
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  async hydrate(store: Store): Promise<void> {
    const db = this.conn.db;
    const [
      tenants,
      admin_users,
      channels,
      identities,
      identity_channels,
      conversations,
      turns,
      playbooks,
      specs,
      actions,
      invocations,
      escalations,
      audit,
      onboarding,
      kb_collections,
      kb_sources,
      kb_chunks,
      eval_suites,
      eval_scenarios,
      eval_runs,
      long_term,
    ] = await Promise.all([
      db.select().from(schema.tenants),
      db.select().from(schema.adminUsers),
      db.select().from(schema.channels),
      db.select().from(schema.endUserIdentities),
      db.select().from(schema.identityChannels),
      db.select().from(schema.conversations),
      db.select().from(schema.turns),
      db.select().from(schema.playbooks),
      db.select().from(schema.apiSpecs),
      db.select().from(schema.actionDefinitions),
      db.select().from(schema.actionInvocations),
      db.select().from(schema.escalations),
      db.select().from(schema.auditEvents),
      db.select().from(schema.onboardingStates),
      db.select().from(schema.kbCollections),
      db.select().from(schema.kbSources),
      db.select().from(schema.kbChunks),
      db.select().from(schema.evalSuites),
      db.select().from(schema.evalScenarios),
      db.select().from(schema.evalRuns),
      db.select().from(schema.longTermMemory),
    ]);

    const snapshot: StoreSnapshot = {
      tenants,
      admin_users,
      channels,
      // The runtime reads channels via listIdentityChannels, so [] is fine here.
      identities: identities.map((i) => ({ ...i, channels: [] })),
      identity_channels,
      conversations,
      turns,
      playbooks: playbooks.map(playbookFromRow),
      specs,
      actions,
      invocations,
      escalations,
      audit,
      onboarding,
      kb_collections,
      kb_sources,
      kb_chunks,
      eval_suites,
      eval_scenarios,
      eval_runs,
      long_term,
    };
    store.load(snapshot);
    log.info({ tenants: tenants.length, conversations: conversations.length }, 'hydrated from postgres');
  }

  async close(): Promise<void> {
    await this.flush();
    await this.conn.close();
  }
}
