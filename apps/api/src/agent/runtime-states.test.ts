import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelType } from '@aelio/types';
import { createContainer, type Container } from '../container.js';
import { readConvoxPhase, CONVOX_PHASE_METADATA_KEY } from '../convox/state-engine.js';

describe('AgentRuntime — guided Convox states', () => {
  let c: Container;
  let tenantId: string;
  const ch = ChannelType.WebChat;
  const who = 'state_test_user';

  beforeEach(() => {
    c = createContainer({ baseUrl: 'http://localhost' });
    tenantId = c.store.getTenantBySlug('acme')!.id;
    expect(c.convox.listStates(tenantId).length).toBeGreaterThan(0);
  });

  async function verify(): Promise<void> {
    const r = await c.runtime.handleInbound({ tenantId, channelType: ch, identifier: who, text: 'hello' });
    const token = r.replies[0]!.url?.split('/').pop()!;
    await c.identity.verifyMagicLink(token);
  }

  it('persists inferred phase and marks tool-satisfied objectives', async () => {
    await verify();

    const churn = await c.runtime.handleInbound({
      tenantId,
      channelType: ch,
      identifier: who,
      text: 'I want to cancel because it is too expensive',
    });
    expect(churn.state).toBe('churn');

    const conv = c.store.findActiveConversation(tenantId, churn.identityId!)!;
    const phase = readConvoxPhase(conv.metadata);
    expect(phase?.currentState).toBe('churn');
    expect(conv.metadata[CONVOX_PHASE_METADATA_KEY]).toBeTruthy();

    const confirm = await c.runtime.handleInbound({
      tenantId,
      channelType: ch,
      identifier: who,
      text: 'downgrade me to starter',
    });
    expect(confirm.replies[0]!.text.toLowerCase()).toContain('go ahead');

    const done = await c.runtime.handleInbound({
      tenantId,
      channelType: ch,
      identifier: who,
      text: 'yes please',
    });
    expect(done.actions).toEqual([
      expect.objectContaining({ key: 'update_plan', status: 'succeeded' }),
    ]);

    const conv2 = c.store.getConversation(tenantId, conv.id)!;
    const phase2 = readConvoxPhase(conv2.metadata);
    expect(phase2?.completedObjectives).toContain('offer_retention');
  });

  it('filters tools to state allowlist in churn phase', async () => {
    await verify();
    await c.runtime.handleInbound({
      tenantId,
      channelType: ch,
      identifier: who,
      text: 'cancel my subscription please',
    });

    const r = await c.runtime.handleInbound({
      tenantId,
      channelType: ch,
      identifier: who,
      text: 'schedule a weekly report for my manager',
    });
    expect(r.actions.find((a) => a.key === 'schedule_report')).toBeUndefined();
  });
});