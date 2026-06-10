import type { Store } from './store.js';

/** Logical entity kinds mirrored to durable storage (map to Postgres tables). */
export type PersistKind =
  | 'tenants'
  | 'admin_users'
  | 'channels'
  | 'identities'
  | 'identity_channels'
  | 'conversations'
  | 'turns'
  | 'playbooks'
  | 'specs'
  | 'actions'
  | 'invocations'
  | 'escalations'
  | 'audit'
  | 'onboarding'
  | 'kb_collections'
  | 'kb_sources'
  | 'kb_chunks'
  | 'eval_suites'
  | 'eval_scenarios'
  | 'eval_runs'
  | 'long_term';

/**
 * Durable-persistence port. The in-memory Store is the synchronous read path
 * (the working set); a Persistence implementation mirrors writes through to a
 * durable backend and hydrates the working set on boot. `InMemoryPersistence`
 * is a no-op; `DrizzlePersistence` writes to Postgres.
 */
export interface Persistence {
  upsert(kind: PersistKind, row: Record<string, unknown>): void;
  remove(kind: PersistKind, id: string): void;
  /** Load the durable state into the in-memory Store at startup. */
  hydrate(store: Store): Promise<void>;
  /** Wait for any pending fire-and-forget writes to settle. */
  flush(): Promise<void>;
  /** GDPR erasure: cascade-delete everything for an identity. */
  eraseIdentity?(tenantId: string, identityId: string): void;
}

/** A full snapshot used to bulk-load the Store during hydration. */
export interface StoreSnapshot {
  tenants?: unknown[];
  admin_users?: unknown[];
  channels?: unknown[];
  identities?: unknown[];
  identity_channels?: unknown[];
  conversations?: unknown[];
  turns?: unknown[];
  playbooks?: unknown[];
  specs?: unknown[];
  actions?: unknown[];
  invocations?: unknown[];
  escalations?: unknown[];
  audit?: unknown[];
  onboarding?: unknown[];
  kb_collections?: unknown[];
  kb_sources?: unknown[];
  kb_chunks?: unknown[];
  eval_suites?: unknown[];
  eval_scenarios?: unknown[];
  eval_runs?: unknown[];
  long_term?: unknown[];
}
