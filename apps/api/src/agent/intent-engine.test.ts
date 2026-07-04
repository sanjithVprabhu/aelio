import { describe, expect, it } from 'vitest';
import { LLMProvider, type LLMClient, type LLMRequest, type LLMResponse } from '@aelio/types';
import { InMemoryKv } from '../store/kv.js';
import {
  type ActiveIntent,
  readActiveIntent,
  resolveActiveIntent,
} from './intent-engine.js';

class StubLlm implements LLMClient {
  constructor(private readonly content: string) {}

  async complete(_request: LLMRequest): Promise<LLMResponse> {
    return {
      content: this.content,
      inputTokens: 0,
      outputTokens: 0,
      model: 'stub',
      provider: LLMProvider.Scripted,
      latencyMs: 0,
    };
  }

  async *stream(): AsyncIterable<never> {}
}

describe('resolveActiveIntent', () => {
  const tenantId = 'tenant_1';
  const identityId = 'identity_1';
  const conversationId = 'conversation_1';
  const actions = [
    {
      key: 'list_team_members',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      key: 'update_plan',
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string' } },
        required: ['plan'],
      },
    },
  ] as never;

  it('does not carry a completed prior intent into an unrelated general turn', async () => {
    const kv = new InMemoryKv();
    const prior: ActiveIntent = {
      intentKey: 'list_team_members',
      args: {},
      missingSlots: [],
      startedAt: Date.now() - 1000,
      lastActivityAt: Date.now() - 1000,
      ttlMs: 30 * 60 * 1000,
    };

    const result = await resolveActiveIntent({
      kv,
      llm: new StubLlm('{"intentKey":"general","args":{}}'),
      tenantId,
      identityId,
      conversationId,
      message: 'can you update plan',
      actions,
      prior,
    });

    expect(result.intent).toBeNull();
    expect(await readActiveIntent(kv, tenantId, identityId)).toBeNull();
  });

  it('keeps an unfinished prior intent active when still collecting slots', async () => {
    const kv = new InMemoryKv();
    const prior: ActiveIntent = {
      intentKey: 'update_plan',
      args: {},
      missingSlots: ['plan'],
      startedAt: Date.now() - 1000,
      lastActivityAt: Date.now() - 1000,
      ttlMs: 30 * 60 * 1000,
    };

    const result = await resolveActiveIntent({
      kv,
      llm: new StubLlm('{"intentKey":"general","args":{}}'),
      tenantId,
      identityId,
      conversationId,
      message: 'pro',
      actions,
      prior,
    });

    expect(result.intent?.intentKey).toBe('update_plan');
    expect(result.intent?.missingSlots).toEqual(['plan']);
  });
});
