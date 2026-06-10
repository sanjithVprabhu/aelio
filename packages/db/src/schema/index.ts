import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  pgEnum,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Production Postgres schema (Drizzle). This is the documented source of truth
 * for persistence. The running API uses an in-memory repository layer with the
 * same shapes so it boots with zero infrastructure; swapping in a Drizzle-backed
 * repository against this schema is the production path.
 *
 * Tenant isolation invariant: every domain row carries tenant_id, and every
 * query filters on it. Audit tables are append-only (enforced by trigger — see
 * migrations/0001_audit_immutability.sql).
 */

export const tenantPlanEnum = pgEnum('tenant_plan', ['lite', 'pro', 'max', 'enterprise']);
export const tenantStatusEnum = pgEnum('tenant_status', [
  'onboarding',
  'active',
  'suspended',
  'churned',
]);
export const dataRegionEnum = pgEnum('data_region', ['us-east-1', 'eu-west-1', 'ap-south-1']);
export const channelStatusEnum = pgEnum('channel_status', [
  'pending_verification',
  'active',
  'suspended',
  'disconnected',
]);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  plan: tenantPlanEnum('plan').notNull().default('lite'),
  status: tenantStatusEnum('status').notNull().default('onboarding'),
  region: dataRegionEnum('region').notNull(),
  llmConfig: jsonb('llm_config').notNull(),
  apiBaseUrl: text('api_base_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const channels = pgTable('channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  type: varchar('type', { length: 50 }).notNull(),
  status: channelStatusEnum('status').notNull().default('pending_verification'),
  config: jsonb('config').notNull(),
  inboundEnabled: boolean('inbound_enabled').notNull().default(true),
  outboundEnabled: boolean('outbound_enabled').notNull().default(false),
  businessHours: jsonb('business_hours'),
  fallbackMessage: text('fallback_message').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const endUserIdentities = pgTable(
  'end_user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    externalUserId: varchar('external_user_id', { length: 255 }).notNull(),
    verificationStatus: varchar('verification_status', { length: 50 }).notNull(),
    verifiedAt: timestamp('verified_at'),
    verificationChannel: varchar('verification_channel', { length: 50 }),
    encryptedAccessToken: text('encrypted_access_token'),
    tokenExpiresAt: timestamp('token_expires_at'),
    currentUserState: varchar('current_user_state', { length: 100 }).notNull().default('unverified'),
    stateInferredAt: timestamp('state_inferred_at').notNull().defaultNow(),
    stateConfidence: doublePrecision('state_confidence').notNull().default(0),
    contextCachedAt: timestamp('context_cached_at'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    byExternal: uniqueIndex('eui_tenant_external').on(t.tenantId, t.externalUserId),
  }),
);

export const identityChannels = pgTable(
  'identity_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identityId: uuid('identity_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    trusted: boolean('trusted').notNull().default(false),
    linkedAt: timestamp('linked_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  },
  (t) => ({
    byIdentifier: uniqueIndex('ic_tenant_channel_identifier').on(
      t.tenantId,
      t.channelType,
      t.identifier,
    ),
  }),
);

export const sessionReferences = pgTable('session_references', {
  id: uuid('id').primaryKey().defaultRandom(),
  identityId: uuid('identity_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    status: varchar('status', { length: 50 }).notNull(),
    activeChannelType: varchar('active_channel_type', { length: 50 }).notNull(),
    channelId: uuid('channel_id').notNull(),
    playbookId: uuid('playbook_id').notNull(),
    playbookVersion: varchar('playbook_version', { length: 50 }).notNull(),
    userStateAtStart: varchar('user_state_at_start', { length: 100 }).notNull(),
    currentUserState: varchar('current_user_state', { length: 100 }).notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
  },
  (t) => ({
    byTenantActivity: index('conv_tenant_activity').on(t.tenantId, t.lastActivityAt),
  }),
);

export const turns = pgTable(
  'turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    role: varchar('role', { length: 20 }).notNull(),
    content: jsonb('content').notNull(),
    channelType: varchar('channel_type', { length: 50 }).notNull(),
    modelUsed: varchar('model_used', { length: 100 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byConversation: index('turns_conversation').on(t.conversationId, t.createdAt),
  }),
);

export const playbooks = pgTable('playbooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).notNull(),
  deploymentMode: varchar('deployment_mode', { length: 50 }),
  gradualRolloutPercent: integer('gradual_rollout_percent'),
  config: jsonb('config').notNull(),
  bootstrappedFromSpecId: uuid('bootstrapped_from_spec_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
});

export const apiSpecs = pgTable('api_specs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  format: varchar('format', { length: 50 }).notNull(),
  baseUrl: text('base_url').notNull(),
  rawContent: text('raw_content').notNull(),
  parsedActions: jsonb('parsed_actions').notNull(),
  warnings: jsonb('warnings').notNull().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const actionDefinitions = pgTable(
  'action_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    specId: uuid('spec_id').notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    description: text('description').notNull(),
    httpMethod: varchar('http_method', { length: 10 }),
    path: text('path'),
    baseUrl: text('base_url').notNull(),
    inputSchema: jsonb('input_schema').notNull(),
    outputSchema: jsonb('output_schema'),
    exposed: boolean('exposed').notNull().default(false),
    tier: integer('tier').notNull().default(0),
    requiredPermissions: jsonb('required_permissions').notNull().default([]),
    confirmationCopy: text('confirmation_copy'),
    beforeAfterTemplate: text('before_after_template'),
    stepUpRequired: boolean('step_up_required').notNull().default(false),
    rateLimitPerUserPerHour: integer('rate_limit_per_user_per_hour').notNull().default(0),
    argConstraints: jsonb('arg_constraints').notNull().default([]),
    preConditions: jsonb('pre_conditions').notNull().default([]),
    postActionMessage: text('post_action_message').notNull().default(''),
    auditFields: jsonb('audit_fields').notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    byKey: uniqueIndex('action_tenant_key').on(t.tenantId, t.key),
    byExposed: index('action_tenant_exposed').on(t.tenantId, t.exposed),
  }),
);

// Append-only. UPDATE/DELETE rejected by DB trigger.
export const actionInvocations = pgTable(
  'action_invocations',
  {
    id: varchar('id', { length: 64 }).primaryKey(), // ULID auditEventId
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    actionKey: varchar('action_key', { length: 255 }).notNull(),
    tier: integer('tier').notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    argsRedacted: jsonb('args_redacted').notNull(),
    responseFields: jsonb('response_fields'),
    errorMessage: text('error_message'),
    latencyMs: integer('latency_ms'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byConversation: index('inv_tenant_conversation').on(t.tenantId, t.conversationId),
    byAction: index('inv_tenant_action').on(t.tenantId, t.actionKey, t.createdAt),
  }),
);

export const pendingConfirmations = pgTable('pending_confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: varchar('token', { length: 512 }).notNull().unique(),
  tenantId: uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  actionKey: varchar('action_key', { length: 255 }).notNull(),
  confirmedArgs: jsonb('confirmed_args').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    identityId: uuid('identity_id').notNull(),
    reason: text('reason').notNull(),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),
    status: varchar('status', { length: 20 }).notNull().default('unassigned'),
    assignedToId: uuid('assigned_to_id'),
    assignedToName: varchar('assigned_to_name', { length: 255 }),
    claimedAt: timestamp('claimed_at'),
    resolvedAt: timestamp('resolved_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index('esc_tenant_status').on(t.tenantId, t.status, t.createdAt),
  }),
);

// Append-only audit trail (immutability enforced via trigger).
export const auditEvents = pgTable(
  'audit_events',
  {
    // App-generated id, often composite (auditEventId:eventType) for gate correlation.
    id: varchar('id', { length: 96 }).primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id'),
    endUserId: uuid('end_user_id'),
    adminUserId: uuid('admin_user_id'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    traceId: varchar('trace_id', { length: 64 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('audit_tenant_created').on(t.tenantId, t.createdAt),
    byConversation: index('audit_conversation').on(t.conversationId),
  }),
);

export const onboardingStates = pgTable('onboarding_states', {
  tenantId: uuid('tenant_id').primaryKey(),
  currentStep: varchar('current_step', { length: 50 }).notNull(),
  completedSteps: jsonb('completed_steps').notNull().default([]),
  specId: uuid('spec_id'),
  channelId: uuid('channel_id'),
  playbookId: uuid('playbook_id'),
  testSessionId: uuid('test_session_id'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---- Knowledge base (pgvector in prod; embedding stored as jsonb here) ----
export const kbCollections = pgTable('kb_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  chunkSize: integer('chunk_size').notNull().default(600),
  overlap: integer('overlap').notNull().default(80),
  embeddingModel: varchar('embedding_model', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const kbSources = pgTable('kb_sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  url: text('url'),
  status: varchar('status', { length: 20 }).notNull(),
  chunkCount: integer('chunk_count').notNull().default(0),
  indexedAt: timestamp('indexed_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceTitle: text('source_title').notNull(),
    content: text('content').notNull(),
    embedding: jsonb('embedding').notNull(),
    tokenCount: integer('token_count').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({ byCollection: index('kb_chunks_collection').on(t.tenantId, t.collectionId) }),
);

// ---- Eval harness ----
export const evalSuites = pgTable('eval_suites', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const evalScenarios = pgTable('eval_scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  steps: jsonb('steps').notNull(),
  expectedFinalState: varchar('expected_final_state', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  suiteId: uuid('suite_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  playbookVersion: varchar('playbook_version', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  passCount: integer('pass_count').notNull().default(0),
  failCount: integer('fail_count').notNull().default(0),
  results: jsonb('results').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

export const longTermMemory = pgTable(
  'long_term_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identityId: uuid('identity_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    key: varchar('key', { length: 255 }).notNull(),
    value: jsonb('value').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    extractedAt: timestamp('extracted_at').notNull().defaultNow(),
  },
  (t) => ({ byIdentity: index('ltm_identity').on(t.tenantId, t.identityId) }),
);
