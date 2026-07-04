/**
 * SunJet integration — KV hot state, L0–L3 memory, rollup, and harness benefits.
 * Requires DATABASE_URL + SUNJET_URL (and GEMINI_API_KEY for real embedding quality).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChannelType } from '@aelio/types';
import { readActiveIntent } from '../agent/intent-engine.js';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const DATABASE_URL = process.env.DATABASE_URL;
const SUNJET_URL = process.env.SUNJET_URL;
const describeSunJet = DATABASE_URL && SUNJET_URL ? describe : describe.skip;

function token(url?: string): string {
  return url ? url.split('/').pop()! : '';
}

async function verifyUser(
  container: Container,
  tenantId: string,
  who: string,
): Promise<string> {
  const first = await container.runtime.handleInbound({
    tenantId,
    channelType: ChannelType.WebChat,
    identifier: who,
    text: 'hello',
  });
  await container.identity.verifyMagicLink(token(first.replies[0]!.url));
  return first.identityId!;
}

describeSunJet('SunJet stack — KV + memory + rollup', () => {
  let app: FastifyInstance;
  let container: Container;
  let tenantId: string;

  beforeAll(async () => {
    process.env.MEMORY_ENGINE = 'sunjet';
    process.env.CONVOX_IN_PROCESS = '1';
    process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? 'google';
    process.env.EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? 'google';

    const built = await buildApp();
    app = built.app;
    container = built.container;
    await app.listen({ port: 0, host: '127.0.0.1' });
    tenantId = container.store.getTenantBySlug('acme')!.id;

    expect(container.sunjet).toBeDefined();
    const health = await container.sunjet!.health();
    expect(health?.status).toBe('ok');
  }, 90_000);

  afterAll(async () => {
    await container?.persistence?.flush();
    await app?.close();
    await container?.persistence?.close();
  });

  it('uses SunJet-backed KV (not in-memory)', () => {
    expect(container.kv.constructor.name).toBe('SunJetKv');
  });

  it('runs the harness phases on a verified turn', async () => {
    const who = `sunjet_harness_${randomUUID()}`;
    await verifyUser(container, tenantId, who);

    const result = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: "what's my plan?",
    });

    expect(result.needsVerification).toBe(false);
    expect(result.harness?.phases).toEqual(
      expect.arrayContaining(['RESOLVE', 'ROUTE', 'PLAN', 'VALIDATE', 'SYNTHESIZE']),
    );
    expect(result.harness!.phases.indexOf('RESOLVE')).toBeLessThan(
      result.harness!.phases.indexOf('SYNTHESIZE'),
    );
  }, 45_000);

  it('persists active intent in SunJet KV across reads', async () => {
    const who = `sunjet_kv_${randomUUID()}`;
    const identityId = await verifyUser(container, tenantId, who);

    await container.kv.set(
      `active_intent:${tenantId}:${identityId}`,
      {
        intentKey: 'update_plan',
        args: { plan: 'pro' },
        missingSlots: [],
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        ttlMs: 30 * 60 * 1000,
      },
      1800,
    );

    const loaded = await readActiveIntent(container.kv, tenantId, identityId);
    expect(loaded?.intentKey).toBe('update_plan');
    expect(loaded?.args.plan).toBe('pro');
  });

  it('indexes turns into SunJet L0 and retrieves them semantically', async () => {
    const who = `sunjet_mem_${randomUUID()}`;
    const identityId = await verifyUser(container, tenantId, who);

    const uniquePhrase = `zephyr-quasar-${randomUUID().slice(0, 8)} revenue digest for CFO`;
    await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: `Please remember: my favorite report is the ${uniquePhrase}.`,
    });

    await sleep(1200);
    await container.persistence?.flush();

    const conversation = container.store
      .listConversations(tenantId)
      .find((c) => c.identityId === identityId)!;

    const history = await container.memory.buildConversationHistory({
      tenantId,
      identityId,
      conversationId: conversation.id,
      queryText: uniquePhrase,
    });

    expect(history.memoryHits).toBeGreaterThan(0);
    expect(
      history.turns.some(
        (t) => t.content.type === 'text' && t.content.text.includes(uniquePhrase),
      ),
    ).toBe(true);
  }, 45_000);

  it('retrieves memory from a prior conversation (cross-session benefit)', async () => {
    const who = `sunjet_cross_${randomUUID()}`;
    const identityId = await verifyUser(container, tenantId, who);
    const marker = `orion-marker-${randomUUID().slice(0, 8)}`;

    await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: `My billing contact email is finance+${marker}@acme.com`,
    });
    await sleep(800);

    const conv1 = container.store
      .listConversations(tenantId)
      .find((c) => c.identityId === identityId)!;
    conv1.status = 'closed' as typeof conv1.status;
    container.store.putConversation(conv1);

    await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'What billing email did I give you earlier?',
    });
    await sleep(1200);
    await container.persistence?.flush();

    const conv2 = container.store
      .listConversations(tenantId)
      .filter((c) => c.identityId === identityId)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0]!;

    const history = await container.memory.buildConversationHistory({
      tenantId,
      identityId,
      conversationId: conv2.id,
      queryText: `billing contact email finance ${marker}`,
    });

    expect(history.memoryHits).toBeGreaterThan(0);
    expect(
      history.turns.some(
        (t) => t.content.type === 'text' && t.content.text.includes(marker),
      ),
    ).toBe(true);
  }, 60_000);

  it('rollup compresses L0 rows into L1 summaries', async () => {
    const result = await container.memory.rollupLayers();
    expect(result).toMatchObject({
      l1: expect.any(Number),
      l2: expect.any(Number),
      l3: expect.any(Number),
    });
  }, 30_000);

  it('reports SunJet health on /readyz', async () => {
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3000;
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = (await res.json()) as {
      memoryEngine?: string;
      sunjet?: { status?: string };
    };
    expect(body.memoryEngine).toBe('sunjet');
    expect(body.sunjet?.status).toBe('ok');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}