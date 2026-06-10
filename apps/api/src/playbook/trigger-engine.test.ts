import { describe, it, expect } from 'vitest';
import type { ActionInvocation, PlaybookTrigger } from '@aelio/types';
import { evaluateTriggers } from './trigger-engine.js';

const cancelTrigger: PlaybookTrigger = {
  id: 't1',
  label: 'cancel → at_risk',
  enabled: true,
  event: { type: 'message_received' },
  condition: { type: 'message_contains', phrases: ['cancel', 'refund'], matchType: 'any' },
  action: { type: 'transition_state', targetState: 'at_risk' },
};

describe('evaluateTriggers', () => {
  it('fires when a phrase matches', () => {
    const fired = evaluateTriggers([cancelTrigger], {
      event: { type: 'message_received' },
      message: 'I want to cancel my plan',
      currentState: 'active',
      actionHistory: [],
    });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.action).toEqual({ type: 'transition_state', targetState: 'at_risk' });
  });

  it('does not fire when disabled', () => {
    const fired = evaluateTriggers([{ ...cancelTrigger, enabled: false }], {
      event: { type: 'message_received' },
      message: 'cancel',
      currentState: 'active',
      actionHistory: [],
    });
    expect(fired).toHaveLength(0);
  });

  it('evaluates AND/OR nested conditions', () => {
    const t: PlaybookTrigger = {
      ...cancelTrigger,
      condition: {
        type: 'and',
        conditions: [
          { type: 'message_contains', phrases: ['cancel'], matchType: 'any' },
          { type: 'state_is', state: 'at_risk' },
        ],
      },
    };
    const ctx = (state: string) => ({
      event: { type: 'message_received' as const },
      message: 'cancel',
      currentState: state,
      actionHistory: [] as ActionInvocation[],
    });
    expect(evaluateTriggers([t], ctx('active'))).toHaveLength(0);
    expect(evaluateTriggers([t], ctx('at_risk'))).toHaveLength(1);
  });
});
