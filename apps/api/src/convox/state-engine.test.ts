import { describe, it, expect } from 'vitest';
import { ScriptedClient } from '@aelio/llm';
import type { StateManifest } from '@aelio/convox-sdk';
import {
  applyToolObjectiveCompletion,
  buildStateGuidanceBlock,
  filterActionsForState,
  inferConvoxPhase,
  readConvoxPhase,
  writeConvoxPhase,
} from './state-engine.js';
import { DEMO_STATE_MANIFESTS } from './demo-states.js';

const STATES: StateManifest[] = DEMO_STATE_MANIFESTS;

describe('state-engine', () => {
  it('buildStateGuidanceBlock renders objective checklist with focus hint', () => {
    const block = buildStateGuidanceBlock(STATES[0], {
      currentState: 'onboarding',
      confidence: 0.8,
      completedObjectives: ['choose_plan'],
    });
    expect(block).toContain('onboarding');
    expect(block).toContain('[x] choose_plan');
    expect(block).toContain('[ ] invite_teammate');
    expect(block).toContain('Focus next on');
  });

  it('filterActionsForState respects optional tool allowlist', () => {
    const all = [
      { key: 'get_account_status' },
      { key: 'cancel_subscription' },
      { key: 'update_plan' },
    ] as Parameters<typeof filterActionsForState>[0];
    const churn = STATES.find((s) => s.key === 'churn')!;
    const filtered = filterActionsForState(all, churn);
    expect(filtered.map((a) => a.key).sort()).toEqual(
      ['cancel_subscription', 'get_account_status', 'update_plan'].sort(),
    );
  });

  it('applyToolObjectiveCompletion marks objectives satisfied by tool', () => {
    const onboarding = STATES.find((s) => s.key === 'onboarding')!;
    const done = applyToolObjectiveCompletion(onboarding, [], ['update_plan', 'share_resource']);
    expect(done).toContain('choose_plan');
    expect(done).toContain('invite_teammate');
    expect(done).not.toContain('schedule_first_report');
  });

  it('inferConvoxPhase falls back to signal matching with scripted LLM', async () => {
    const phase = await inferConvoxPhase({
      llm: new ScriptedClient(),
      tenantId: 't1',
      conversationId: 'c1',
      states: STATES,
      history: [],
      currentMessage: 'I want to cancel because it is too expensive',
      prior: { currentState: 'active', confidence: 0.6, completedObjectives: [] },
    });
    expect(phase.currentState).toBe('churn');
    expect(phase.confidence).toBeGreaterThan(0);
  });

  it('readConvoxPhase / writeConvoxPhase round-trip metadata', () => {
    const meta = writeConvoxPhase({}, {
      currentState: 'onboarding',
      confidence: 0.9,
      reason: 'test',
      completedObjectives: ['choose_plan'],
    });
    const phase = readConvoxPhase(meta);
    expect(phase?.currentState).toBe('onboarding');
    expect(phase?.completedObjectives).toEqual(['choose_plan']);
  });
});