import { describe, it, expect } from 'vitest';
import { ScriptedClient } from './scripted.js';
import type { LLMRequest, LLMTool } from '@aelio/types';

const tools: LLMTool[] = [
  { name: 'get_account_status', description: 'Read account', inputSchema: {} },
  { name: 'cancel_subscription', description: 'Cancel', inputSchema: {} },
  { name: 'update_plan', description: 'Change plan', inputSchema: {} },
];

function req(userText: string, extra: Partial<LLMRequest> = {}): LLMRequest {
  return {
    messages: [{ role: 'user', content: userText }],
    tools,
    tenantId: 't1',
    conversationId: 'c1',
    ...extra,
  };
}

describe('ScriptedClient', () => {
  const c = new ScriptedClient();

  it('routes a status question to get_account_status', async () => {
    const r = await c.complete(req("what's my plan?"));
    expect(r.toolCalls?.[0]?.name).toBe('get_account_status');
  });

  it('routes a cancel request to cancel_subscription', async () => {
    const r = await c.complete(req('I want to cancel my subscription'));
    expect(r.toolCalls?.[0]?.name).toBe('cancel_subscription');
  });

  it('extracts the plan name on a downgrade', async () => {
    const r = await c.complete(req('please downgrade me to Starter'));
    expect(r.toolCalls?.[0]?.name).toBe('update_plan');
    expect(r.toolCalls?.[0]?.args).toEqual({ plan: 'starter' });
  });

  it('writes a closing reply after a tool result', async () => {
    const r = await c.complete(
      req('cancel', {
        messages: [
          { role: 'user', content: 'cancel' },
          { role: 'assistant', content: '' },
          {
            role: 'tool',
            content: [{ toolCallId: 'x', content: { status: 'cancelled' } }],
          },
        ],
      }),
    );
    expect(r.toolCalls).toBeUndefined();
    expect(r.content.toLowerCase()).toContain('cancelled');
  });

  it('greets on hello', async () => {
    const r = await c.complete(req('hello there'));
    expect(r.toolCalls).toBeUndefined();
    expect(r.content.toLowerCase()).toContain('hi');
  });

  it('routes give me account status to get_account_status', async () => {
    const r = await c.complete(req('give me account status'));
    expect(r.toolCalls?.[0]?.name).toBe('get_account_status');
  });
});
