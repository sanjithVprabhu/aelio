/**
 * Full-stack integration: InMemoryKv smoke + optional SunJet/Postgres harness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChannelType } from '@aelio/types';
import { createContainer, initContainer } from '../container.js';
import { buildApp } from '../app.js';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

const DATABASE_URL = process.env.DATABASE_URL;
const SUNJET_URL = process.env.SUNJET_URL;
const describeSunJet = DATABASE_URL && SUNJET_URL ? describe : describe.skip;

function token(url?: string): string {
  return url ? url.split('/').pop()! : '';
}

describe('full stack — InMemoryKv container', () => {
  it('createContainer works with InMemoryKv', () => {
    const c = createContainer({ allowInMemory: true });
    expect(c.kv).toBeDefined();
    expect(c.runtime).toBeDefined();
    expect(c.demoTenantSlug).toBe('acme');
    expect(c.store.getTenantBySlug('acme')).toBeTruthy();
  });
});

describeSunJet('full stack — postgres + sunjet harness phases', () => {
  let app: FastifyInstance;
  let container: Container;
  let tenantId: string;

  beforeAll(async () => {
    process.env.EMBEDDING_PROVIDER = 'hash';
    process.env.LLM_PROVIDER = 'scripted';
    process.env.CONVOX_IN_PROCESS = '1';
    process.env.BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:0';

    const built = await buildApp(await initContainer({ allowInMemory: false }));
    app = built.app;
    container = built.container;
    await app.listen({ port: 0, host: '127.0.0.1' });

    tenantId = container.store.getTenantBySlug('acme')!.id;
  }, 60_000);

  afterAll(async () => {
    await container?.persistence?.flush();
    await app?.close();
    await container?.persistence?.close();
  });

  it('runs harness phases on a verified turn', async () => {
    const who = `full_stack_harness_${randomUUID()}`;
    const first = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: 'hello',
    });
    expect(first.needsVerification).toBe(true);
    await container.identity.verifyMagicLink(token(first.replies[0]!.url));

    const result = await container.runtime.handleInbound({
      tenantId,
      channelType: ChannelType.WebChat,
      identifier: who,
      text: "what's my plan?",
    });

    expect(result.harness).toBeDefined();
    expect(result.harness!.phases).toEqual(
      expect.arrayContaining(['RESOLVE', 'ROUTE', 'PLAN', 'VALIDATE', 'SYNTHESIZE']),
    );
    expect(result.harness!.phases.indexOf('RESOLVE')).toBeLessThan(result.harness!.phases.indexOf('SYNTHESIZE'));
  }, 30_000);

  it('loads flows from Postgres for the demo tenant', async () => {
    expect(container.flows.length).toBeGreaterThan(0);
    expect(container.flows.some((f) => f.stateKey === 'onboarding')).toBe(true);
  }, 10_000);
});