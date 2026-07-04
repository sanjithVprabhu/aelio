/**
 * SunJet engine deep tests — KV, vectors, rollup, isolation, durability.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChannelType } from '@aelio/types';
import { readActiveIntent } from '../agent/intent-engine.js';
import { getEnvSnapshot, putEnvSnapshot } from '../agent/env-snapshot.js';
import { hasFullStackEnv, sleep } from './fixtures/e2e-env.js';
import { bootConvoxE2eStack, shutdownE2eStack, verifyViaChat, type E2eStack } from './fixtures/e2e-app.js';

const describeE2e = hasFullStackEnv() ? describe : describe.skip;

describeE2e('SunJet engine (deep)', () => {
  let stack: E2eStack;

  beforeAll(async () => {
    stack = await bootConvoxE2eStack();
  }, 120_000);

  afterAll(async () => {
    await shutdownE2eStack(stack);
  });

  it('health: ll-server and daemon respond', async () => {
    const sj = stack.container.sunjet!;
    expect((await sj.health()).status).toBe('ok');
    const daemon = await sj.daemonHealth();
    expect(daemon).toBeTruthy();
  });

  it('KV: magic link token stored and consumed in runtime_state', async () => {
    const sessionId = `sj_kv_magic_${randomUUID()}`;
    const hello = await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: 'hi',
    });
    const url = hello.replies[0]?.url ?? '';
    const token = url.split('/').pop()!;
    const stored = await stack.container.kv.get<{ tenantId: string; identityId: string }>(
      `magic_link:${token}`,
    );
    expect(stored?.tenantId).toBe(stack.tenantId);
  });

  it('KV: active intent round-trip', async () => {
    const identityId = `id_${randomUUID()}`;
    const key = `active_intent:${stack.tenantId}:${identityId}`;
    await stack.container.kv.set(
      key,
      {
        intentKey: 'schedule_report',
        args: { report: 'weekly', recipient: 'cfo@acme.com' },
        missingSlots: [],
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        ttlMs: 1_800_000,
      },
      3600,
    );
    const loaded = await readActiveIntent(stack.container.kv, stack.tenantId, identityId);
    expect(loaded?.intentKey).toBe('schedule_report');
    expect(loaded?.args.recipient).toBe('cfo@acme.com');
  });

  it('KV: env snapshot TTL write/read', async () => {
    const identityId = `id_${randomUUID()}`;
    await putEnvSnapshot(stack.container.kv, stack.tenantId, identityId, 'get_invoice', {
      amount: 99,
    });
    const snap = await getEnvSnapshot(stack.container.kv, stack.tenantId, identityId, 'get_invoice');
    expect(snap?.payload).toEqual({ amount: 99 });
  });

  it('KV: incr counter for rate limits', async () => {
    const key = `rate_test:${randomUUID()}`;
    const a = await stack.container.kv.incr(key);
    const b = await stack.container.kv.incr(key);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('Memory L0: indexes and retrieves semantically (Gemini embeddings)', async () => {
    const sessionId = `sj_mem_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const marker = `cassiopeia-${randomUUID().slice(0, 8)}`;
    await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: `Remember my project codename is ${marker} for the analytics rollout.`,
    });
    await sleep(1500);
    await stack.container.persistence?.flush();

    const ic = stack.container.store.findIdentityChannel(
      stack.tenantId,
      ChannelType.WebChat,
      sessionId,
    )!;
    const conv = stack.container.store.findActiveConversation(stack.tenantId, ic.identityId)!;
    const history = await stack.container.memory.buildConversationHistory({
      tenantId: stack.tenantId,
      identityId: ic.identityId,
      conversationId: conv.id,
      queryText: `project codename ${marker} analytics`,
    });
    expect(history.memoryHits).toBeGreaterThan(0);
    expect(
      history.turns.some((t) => t.content.type === 'text' && t.content.text.includes(marker)),
    ).toBe(true);
  }, 60_000);

  it('Memory: unrelated query scores lower hit relevance', async () => {
    const sessionId = `sj_rel_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const marker = `unique-nebula-${randomUUID().slice(0, 8)}`;
    await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: `My secret passphrase is ${marker}.`,
    });
    await sleep(1200);

    const ic = stack.container.store.findIdentityChannel(
      stack.tenantId,
      ChannelType.WebChat,
      sessionId,
    )!;
    const conv = stack.container.store.findActiveConversation(stack.tenantId, ic.identityId)!;
    const relevant = await stack.container.memory.buildConversationHistory({
      tenantId: stack.tenantId,
      identityId: ic.identityId,
      conversationId: conv.id,
      queryText: marker,
    });
    const irrelevant = await stack.container.memory.buildConversationHistory({
      tenantId: stack.tenantId,
      identityId: ic.identityId,
      conversationId: conv.id,
      queryText: 'weather forecast tokyo sushi restaurant',
    });
    expect(relevant.memoryHits).toBeGreaterThanOrEqual(irrelevant.memoryHits);
  }, 60_000);

  it('Memory: cross-conversation retrieval', async () => {
    const sessionId = `sj_cross_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const marker = `vega-${randomUUID().slice(0, 8)}`;
    await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: `Billing POC is billing+${marker}@corp.com`,
    });
    await sleep(800);
    const ic = stack.container.store.findIdentityChannel(
      stack.tenantId,
      ChannelType.WebChat,
      sessionId,
    )!;
    const conv1 = stack.container.store.findActiveConversation(stack.tenantId, ic.identityId)!;
    conv1.status = 'closed' as typeof conv1.status;
    stack.container.store.putConversation(conv1);

    await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: 'What billing email did I share?',
    });
    await sleep(1200);

    const conv2 = stack.container.store
      .listConversations(stack.tenantId)
      .filter((c) => c.identityId === ic.identityId)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0]!;
    const history = await stack.container.memory.buildConversationHistory({
      tenantId: stack.tenantId,
      identityId: ic.identityId,
      conversationId: conv2.id,
      queryText: `billing POC ${marker}`,
    });
    expect(history.memoryHits).toBeGreaterThan(0);
  }, 60_000);

  it('Rollup: L0→L1→L2→L3 pipeline executes', async () => {
    const result = await stack.container.memory.rollupLayers();
    expect(result.l1).toBeGreaterThanOrEqual(0);
    expect(result.l2).toBeGreaterThanOrEqual(0);
    expect(result.l3).toBeGreaterThanOrEqual(0);
  }, 45_000);

  it('Isolation: tenant filter prevents cross-tenant memory bleed', async () => {
    const client = stack.container.sunjet!;
    const dim = 1536;
    await client.ensureMemoryL0Schema(dim);
    const tenantA = `tenant_a_${randomUUID().slice(0, 6)}`;
    const tenantB = `tenant_b_${randomUUID().slice(0, 6)}`;
    const fakeEmbed = Array.from({ length: dim }, (_, i) => (i % 7) / dim);

    await client.insertRow('memory_l0', {
      tenant_id: { type: 'utf8', value: tenantA },
      identity_id: { type: 'utf8', value: 'user_a' },
      conversation_id: { type: 'utf8', value: 'conv_a' },
      intent_key: { type: 'utf8', value: '_turn' },
      phase: { type: 'utf8', value: 'user' },
      body: { type: 'utf8', value: 'SECRET_TENANT_A_ONLY' },
      embedding: { type: 'vector', value: fakeEmbed },
      started_at: { type: 'i64', value: Date.now() },
      ended_at: { type: 'i64', value: Date.now() },
    });

    const { results } = await client.query('memory_l0', {
      k: 5,
      vector: { col: 'embedding', query: fakeEmbed },
      filters: [
        { col: 'tenant_id', op: 'eq', value: { type: 'utf8', value: tenantB } },
        { col: 'identity_id', op: 'eq', value: { type: 'utf8', value: 'user_b' } },
      ],
    });
    const leaked = results.some((r) => r.values?.body?.type === 'utf8' && r.values.body.value?.includes('SECRET_TENANT_A'));
    expect(leaked).toBe(false);
  }, 30_000);
});