import { createLLMClient } from '@aelio/llm';
import { createEmbedder } from '@aelio/embedder';
import { createMemoryEngine } from '@aelio/memory-engine';
import { SunJetClient } from '@aelio/sunjet-client';
import {
  ChannelStatus,
  ChannelType,
  LLMProvider,
  TenantPlan,
  TenantStatus,
  DataRegion,
  type Channel,
  type LLMClient,
  type Tenant,
} from '@aelio/types';
import { Store } from './store/store.js';
import { InMemoryKv, type Kv } from './store/kv.js';
import { SunJetKv } from './state/sunjet-kv.js';
import { DrizzlePersistence } from './store/pg-persistence.js';
import { PolicyService } from './policy/policy-service.js';
import { IdentityService } from './identity/identity-service.js';
import { AgentRuntime } from './agent/runtime.js';
import { createTenantLlmClients } from './llm/tenant-llm.js';
import {
  defaultLlmModel,
  platformLlmConfig,
  resolvePlatformApiKey,
  resolvePlatformLlmProvider,
} from './llm/platform-llm.js';
import { MemoryService } from './agent/memory.js';
import { Telemetry } from './agent/telemetry.js';
import { ConvoxRegistry } from './convox/registry.js';
import { ConvoxBridge } from './convox/bridge.js';
import { ConvoxStateBridge } from './convox/state-bridge.js';
import { ConvoxFlowBridge } from './convox/flow-bridge.js';
import { ConvoxExecutor } from './convox/executor.js';
import { buildDemoHandlers, DEMO_TOOL_MANIFESTS } from './convox/demo-tools.js';
import { DEMO_STATE_MANIFESTS } from './convox/demo-states.js';
import { DEMO_SAAS_FLOWS } from '@aelio/demo-saas';
import { PgEpisodeStore } from './memory/episode-store.js';
import { OutboxService } from './daemon/outbox-service.js';
import { FlowStore } from './flows/flow-store.js';
import type { FlowDefinition } from './flows/flow-engine.js';
import { hashPassword } from '@aelio/crypto';
import { uuid } from './util/id.js';
import { resolveServerRuntimeConfig } from './runtime/server-config.js';

export interface Container {
  store: Store;
  kv: Kv;
  llm: LLMClient;
  identity: IdentityService;
  policy: PolicyService;
  convox: ConvoxRegistry;
  convoxBridge: ConvoxBridge;
  convoxStateBridge: ConvoxStateBridge;
  convoxFlowBridge: ConvoxFlowBridge;
  memory: MemoryService;
  telemetry: Telemetry;
  runtime: AgentRuntime;
  outbox: OutboxService;
  flowStore: FlowStore;
  flows: FlowDefinition[];
  sunjet?: SunJetClient;
  baseUrl: string;
  demoTenantSlug: string;
  persistence?: DrizzlePersistence;
}

export interface ContainerOptions {
  baseUrl?: string;
  llm?: LLMClient;
  kv?: Kv;
  allowInMemory?: boolean;
}

function buildSunJetClient(): SunJetClient | undefined {
  const url = process.env.SUNJET_URL;
  if (!url) return undefined;
  return new SunJetClient({
    baseUrl: url,
    apiKey: process.env.SUNJET_API_KEY,
    daemonUrl: process.env.SUNJET_DAEMON_URL,
    daemonApiKey: process.env.SUNJET_DAEMON_API_KEY,
  });
}

export async function applyConvoxFlowMessage(
  c: Container,
  tenantId: string,
  message?: import('@aelio/convox-sdk').ClientMessage,
): Promise<void> {
  if (message?.type === 'flow_remove') {
    c.flows = await c.convoxFlowBridge.remove(tenantId, message.stateKey, message.objectiveKey);
  } else if (message?.type === 'flow_upsert') {
    await c.convoxFlowBridge.upsert(tenantId, message.flow);
    c.flows = await c.convoxFlowBridge.syncFromRegistry(tenantId);
  } else {
    c.flows = await c.convoxFlowBridge.syncFromRegistry(tenantId);
  }
  const tenant = c.store.getTenant(tenantId);
  if (tenant) rebuildRuntime(c, tenant);
}

export function rebuildRuntime(c: Container, tenant?: Tenant): void {
  c.runtime = buildRuntime(
    c.store,
    c.kv,
    c.identity,
    c.policy,
    c.llm,
    c.memory,
    c.telemetry,
    c.convox,
    c.outbox,
    tenant,
    c.flows,
  );
}

function buildRuntime(
  store: Store,
  kv: Kv,
  identity: IdentityService,
  policy: PolicyService,
  llm: LLMClient,
  memory: MemoryService,
  telemetry: Telemetry,
  convox: ConvoxRegistry,
  outbox: OutboxService,
  tenant?: Tenant,
  flows: FlowDefinition[] = [],
): AgentRuntime {
  const clients = tenant ? createTenantLlmClients(tenant) : { resolve: llm, synthesize: llm };
  return new AgentRuntime(
    store,
    identity,
    policy,
    llm,
    memory,
    telemetry,
    convox,
    kv,
    (input) => {
      void outbox.pushConvoxEvent(input.tenantId, {
        eventType: 'phase_changed',
        identityId: input.identityId,
        payload: {
          currentState: input.phase.currentState,
          confidence: input.phase.confidence,
          completedObjectives: input.phase.completedObjectives,
        },
      });
    },
    { resolveLlm: clients.resolve, synthesizeLlm: clients.synthesize },
    flows,
  );
}

function assemble(
  opts: ContainerOptions,
  kv: Kv,
  sunjet?: SunJetClient,
): Omit<Container, 'demoTenantSlug' | 'persistence'> {
  const baseUrl = opts.baseUrl ?? process.env.BASE_URL ?? 'http://localhost:3000';
  const store = new Store();
  const convox = new ConvoxRegistry();
  const convoxBridge = new ConvoxBridge(store, convox);
  const convoxStateBridge = new ConvoxStateBridge(undefined, convox);
  const flowStore = new FlowStore();
  const convoxFlowBridge = new ConvoxFlowBridge(flowStore, convox);
  const sunjetClient = sunjet ?? buildSunJetClient();

  const provider = resolvePlatformLlmProvider();
  const model = defaultLlmModel(provider);
  const apiKey = resolvePlatformApiKey(provider);
  const llm = opts.llm ?? createLLMClient({ config: { mode: 'platform', provider, model }, apiKey });

  const identity = new IdentityService(store, kv, baseUrl);
  const executor = new ConvoxExecutor(store, convox, identity);
  const policy = new PolicyService(store, kv, executor, identity);
  const memory = new MemoryService(kv, store);
  const telemetry = new Telemetry(store);
  const outbox = new OutboxService(undefined, convox, sunjetClient);
  const runtime = buildRuntime(store, kv, identity, policy, llm, memory, telemetry, convox, outbox);

  return {
    store,
    kv,
    llm,
    identity,
    policy,
    convox,
    convoxBridge,
    convoxStateBridge,
    convoxFlowBridge,
    memory,
    telemetry,
    runtime,
    outbox,
    flowStore,
    flows: [],
    sunjet: sunjetClient,
    baseUrl,
  };
}

async function buildKv(opts: ContainerOptions, sunjet?: SunJetClient): Promise<Kv> {
  if (opts.kv) return opts.kv;
  if (sunjet ?? process.env.SUNJET_URL) {
    const client = sunjet ?? buildSunJetClient();
    if (!client) throw new Error('SUNJET_URL is set but SunJet client could not be created.');
    const sunjetKv = new SunJetKv(client);
    await sunjetKv.ensureReady();
    return sunjetKv;
  }
  return new InMemoryKv();
}

export function createContainer(opts: ContainerOptions = {}): Container {
  const kv = opts.kv ?? new InMemoryKv();
  const core = assemble(opts, kv, buildSunJetClient());
  const demoTenantSlug = seedDemoTenant(core, { inProcessConvox: true });
  const tenant = core.store.getTenantBySlug(demoTenantSlug);
  const flows = core.flowStore.defaultFlows();
  if (tenant) {
    core.runtime = buildRuntime(
      core.store,
      kv,
      core.identity,
      core.policy,
      core.llm,
      core.memory,
      core.telemetry,
      core.convox,
      core.outbox,
      tenant,
      flows,
    );
  }
  core.outbox.start();
  return { ...core, demoTenantSlug, flows };
}

export async function initContainer(opts: ContainerOptions = {}): Promise<Container> {
  const databaseUrl = process.env.DATABASE_URL;
  const allowInMemory = opts.allowInMemory ?? resolveServerRuntimeConfig().allowInMemoryBoot;
  if (!databaseUrl && !allowInMemory) {
    throw new Error(
      'DATABASE_URL is required. Start Postgres (docker compose up postgres) and set DATABASE_URL.',
    );
  }

  const sunjet = buildSunJetClient();
  const kv = await buildKv(opts, sunjet);
  const core = assemble(opts, kv, sunjet);

  let persistence: DrizzlePersistence | undefined;
  let flows: FlowDefinition[] = core.flowStore.defaultFlows();
  if (databaseUrl) {
    persistence = await DrizzlePersistence.connect(databaseUrl);
    core.store.setPersistence(persistence);
    await persistence.hydrate(core.store);
    core.flowStore = new FlowStore(persistence.sql);
    core.convoxFlowBridge = new ConvoxFlowBridge(core.flowStore, core.convox);

    const embedder = createEmbedder();
    const engine = createMemoryEngine({
      sql: persistence.sql,
      embedder,
      sunjetUrl: process.env.SUNJET_URL,
      sunjetApiKey: process.env.SUNJET_API_KEY,
      sunjetDaemonUrl: process.env.SUNJET_DAEMON_URL,
      bodies: new PgEpisodeStore(persistence.sql),
    });
    if (engine) {
      await engine.ensureReady();
      core.memory.setMemoryEngine(engine);
    }

    core.convoxStateBridge = new ConvoxStateBridge(persistence.sql, core.convox);
    core.outbox = new OutboxService(persistence.sql, core.convox, core.sunjet);
  }

  const inProcessConvox = process.env.CONVOX_IN_PROCESS === '1';
  let demoTenantSlug: string;
  if (!core.store.hasData()) {
    demoTenantSlug = seedDemoTenant(core, { inProcessConvox });
    const seeded = core.store.getTenantBySlug(demoTenantSlug);
    if (persistence && seeded) await core.flowStore.seedDemoFlows(seeded.id);
    if (persistence) await persistence.flush();
  } else {
    demoTenantSlug = core.store.getTenantBySlug('acme') ? 'acme' : (core.store.listTenants()[0]?.slug ?? 'acme');
    const tenant = core.store.getTenantBySlug(demoTenantSlug);
    if (tenant) ensureTenantConvoxApiKey(core.store, tenant.id);
    if (!inProcessConvox && tenant) core.convoxBridge.syncFromRegistry(tenant.id);
  }

  const runtimeTenant = core.store.getTenantBySlug(demoTenantSlug) ?? core.store.listTenants()[0];
  if (runtimeTenant) {
    flows = await core.flowStore.listApproved(runtimeTenant.id);
  }
  core.runtime = buildRuntime(
    core.store,
    kv,
    core.identity,
    core.policy,
    core.llm,
    core.memory,
    core.telemetry,
    core.convox,
    core.outbox,
    runtimeTenant,
    flows,
  );

  if (persistence) {
    const tenantIds = core.store.listTenants().map((t) => t.id);
    await core.convoxStateBridge.hydrateAll(tenantIds);
    for (const id of tenantIds) await core.convoxStateBridge.syncFromRegistry(id);
  }

  core.outbox.start();

  if (core.sunjet) {
    const health = await core.sunjet.health().catch(() => null);
    if (health) console.log(`[sunjet] ll-server ok (${process.env.SUNJET_URL})`);
    const daemon = await core.sunjet.daemonHealth();
    if (daemon) console.log(`[sunjet] daemon ok (${process.env.SUNJET_DAEMON_URL})`);
  }

  return { ...core, demoTenantSlug, persistence, flows };
}

function ensureTenantConvoxApiKey(store: Store, tenantId: string): void {
  if (!store.getTenantApiKey(tenantId)) {
    store.putTenantApiKey(tenantId, process.env.DEMO_CONVOX_API_KEY ?? 'test_api_key');
  }
}

function seedDemoTenant(
  a: Omit<Container, 'demoTenantSlug' | 'persistence'>,
  opts: { inProcessConvox: boolean },
): string {
  const tenantId = uuid();
  const now = new Date();
  const tenant: Tenant = {
    id: tenantId,
    name: 'Acme Analytics',
    slug: 'acme',
    plan: TenantPlan.Pro,
    status: TenantStatus.Active,
    region: DataRegion.UsEast,
    llmConfig: platformLlmConfig(),
    apiBaseUrl: 'convox://live',
    createdAt: now,
    updatedAt: now,
  };
  a.store.putTenant(tenant);
  a.store.putTenantApiKey(tenantId, process.env.DEMO_CONVOX_API_KEY ?? 'test_api_key');

  a.store.putAdminUser({
    id: uuid(),
    tenantId,
    email: 'admin@acme.com',
    name: 'Acme Admin',
    role: 'owner',
    passwordHash: hashPassword('password'),
    createdAt: now,
  });

  if (opts.inProcessConvox) {
    a.convox.registerInProcess(tenantId, DEMO_TOOL_MANIFESTS, buildDemoHandlers());
    a.convox.registerInProcessStates(tenantId, DEMO_STATE_MANIFESTS);
    a.convox.registerInProcessFlows(tenantId, DEMO_SAAS_FLOWS);
    a.convoxBridge.syncFromRegistry(tenantId);
    void a.convoxStateBridge.syncFromRegistry(tenantId);
  }

  const channel: Channel = {
    id: uuid(),
    tenantId,
    type: ChannelType.WebChat,
    status: ChannelStatus.Active,
    config: {
      type: 'web_chat',
      widgetName: 'Aelio',
      accentColor: '#0A0A0A',
      allowedOrigins: ['*'],
    },
    inboundEnabled: true,
    outboundEnabled: true,
    fallbackMessage: "We're momentarily unavailable — please try again shortly.",
    createdAt: now,
    updatedAt: now,
  };
  a.store.putChannel(channel);

  return tenant.slug;
}
