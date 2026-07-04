/**
 * End-to-end: Postgres + pgvector memory + Convox Mode B (external customer app).
 * Requires DATABASE_URL (pgvector image) and runs a live Fastify server + WS client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AelioConvox } from '@aelio/convox-sdk';
import { registerDemoSaasStates } from '@aelio/demo-saas';
import { readConvoxPhase } from '../convox/state-engine.js';
import { ChannelType } from '@aelio/types';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeE2e = DATABASE_URL ? describe : describe.skip;

function token(url?: string): string {
  return url ? url.split('/').pop()! : '';
}

describeE2e('minimal v1 stack (postgres + pgvector + convox B)', () => {
  let app: FastifyInstance;
  let container: Container;
  let baseUrl: string;
  let convox: AelioConvox;
  let tenantId: string;

  beforeAll(async () => {
    process.env.EMBEDDING_PROVIDER = 'hash';
    process.env.LLM_PROVIDER = 'scripted';
    process.env.CONVOX_IN_PROCESS = '0';
    process.env.BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:0';

    const built = await buildApp();
    app = built.app;
    container = built.container;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 3000;
    baseUrl = `http://127.0.0.1:${port}`;

    tenantId = container.store.getTenantBySlug('acme')!.id;

    convox = new AelioConvox({
      tenantId: 'acme',
      apiKey: 'test_api_key',
      aelioBaseUrl: baseUrl,
    });

    convox.tool('get_account_status', {
      description: 'Get account status',
      inputSchema: { type: 'object', properties: {} },
      handler: async (ctx) => ({ plan: 'pro', seats: 5, status: 'active', user: ctx.externalUserId }),
    });

    convox.tool('update_plan', {
      description: 'Change plan',
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string' } },
        required: ['plan'],
      },
      handler: async (_ctx, args) => ({ plan: String(args.plan), updated: true }),
    });

    convox.tool('cancel_subscription', {
      description: 'Cancel subscription',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ status: 'cancelled' }),
    });

    registerDemoSaasStates(convox);

    await convox.connect();
    await waitFor(() => container.convox.listTools(tenantId).length >= 3, 5000);
    await waitFor(() => container.convox.listStates(tenantId).length >= 3, 5000);
    container.convoxBridge.syncFromRegistry(tenantId);
    await container.persistence?.flush();
    await waitFor(
      () => container.store.listExposedActions(tenantId).some((a) => a.key === 'get_account_status'),
      3000,
    );
  }, 60_000);

  afterAll(async () => {
    await convox?.disconnect();
    await container?.persistence?.flush();
    await app?.close();
    await container?.persistence?.close();
  });

  it('registers live Convox tools over WebSocket', () => {
    const tools = container.convox.listTools(tenantId).map((t) => t.key);
    expect(tools).toContain('get_account_status');
    expect(container.store.listExposedActions(tenantId).length).toBeGreaterThan(0);
  });

  it('registers guided Convox states and infers churn with objectives', async () => {
    const states = container.convox.listStates(tenantId).map((s) => s.key);
    expect(states).toEqual(expect.arrayContaining(['onboarding', 'active', 'churn']));

    const who = `e2e_state_user_${randomUUID()}`;
    const first = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'hello',
    });
    await container.identity.verifyMagicLink(token(first.replies[0]!.url));

    const churn = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'I want to cancel because it is too expensive',
    });
    expect(churn.state).toBe('churn');
    expect(churn.convoxPhase?.currentState).toBe('churn');
    expect(churn.objectives?.length).toBeGreaterThan(0);

    const conv = container.store.findActiveConversation(tenantId, churn.identityId!)!;
    expect(readConvoxPhase(conv.metadata)?.currentState).toBe('churn');
  });

  it('runs magic link → tier-0 read via external Convox handler', async () => {
    if (!convox.isConnected) await convox.connect();
    container.convoxBridge.syncFromRegistry(tenantId);
    expect(container.store.getActionByKey(tenantId, 'get_account_status')?.exposed).toBe(true);

    const who = `e2e_web_user_${randomUUID()}`;
    const first = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'hello',
    });
    expect(first.needsVerification).toBe(true);
    await container.identity.verifyMagicLink(token(first.replies[0]!.url));

    const second = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: "what's my plan?",
    });
    expect(second.needsVerification).toBe(false);
    expect(second.actions).toEqual([
      expect.objectContaining({ key: 'get_account_status', status: 'succeeded' }),
    ]);
  });

  it('retrieves prior turns via pgvector memory across conversations', async () => {
    const who = `e2e_memory_user_${randomUUID()}`;
    const verify = async () => {
      const r = await container.runtime.handleInbound({
        tenantId,
        channelType: ChannelType.WebChat,
        identifier: who,
        text: 'hi',
      });
      await container.identity.verifyMagicLink(token(r.replies[0]!.url));
    };
    await verify();

    await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'My favorite report is the quarterly revenue summary for leadership.',
    });

    await sleep(800);
    await container.persistence?.flush();

    const ic = container.store.findIdentityChannel(tenantId, ChannelType.WebChat, who)!;
    const conversation = container.store
      .listConversations(tenantId)
      .find((c) => c.identityId === ic.identityId)!;
    const history = await container.memory.buildConversationHistory({
      tenantId,
      identityId: ic.identityId,
      conversationId: conversation.id,
      queryText: 'quarterly revenue report',
    });

    expect(history.memoryHits).toBeGreaterThan(0);
    expect(
      history.turns.some((t) => t.content.type === 'text' && t.content.text.includes('quarterly revenue')),
    ).toBe(true);
  }, 30_000);

  it('serves health and chat HTTP endpoints', async () => {
    const health = await fetch(`${baseUrl}/healthz`);
    expect(health.ok).toBe(true);

    const chat = await fetch(`${baseUrl}/api/v1/chat/acme/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: `e2e_sess_http_${randomUUID()}`, text: 'hello' }),
    });
    expect(chat.ok).toBe(true);
    const body = (await chat.json()) as { needsVerification?: boolean };
    expect(body.needsVerification).toBe(true);
  });
});

async function waitFor(pred: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
