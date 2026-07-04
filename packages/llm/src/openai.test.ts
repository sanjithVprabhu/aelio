import { describe, it, expect } from 'vitest';
import { toOpenAIMessages } from './openai.js';
import type { LLMMessage } from '@aelio/types';

describe('toOpenAIMessages', () => {
  it('replays assistant tool_calls before tool results', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'what plan am I on?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_account_status', args: {} }],
      },
      {
        role: 'tool',
        content: [{ toolCallId: 'call_1', content: { plan: 'pro' } }],
      },
    ];
    const out = toOpenAIMessages(messages);
    expect(out[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', type: 'function' }],
    });
    expect(out[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });
});