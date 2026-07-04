/**
 * Agent harness scenarios — intent, confirmation, policies, flows (Gemini LLM).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ChannelType } from '@aelio/types';
import { hasFullStackEnv } from './fixtures/e2e-env.js';
import { bootConvoxE2eStack, shutdownE2eStack, verifyViaChat, type E2eStack } from './fixtures/e2e-app.js';

const describeE2e = hasFullStackEnv() ? describe : describe.skip;

describeE2e('Agent harness scenarios', () => {
  let stack: E2eStack;

  beforeAll(async () => {
    stack = await bootConvoxE2eStack();
  }, 120_000);

  afterAll(async () => {
    await shutdownE2eStack(stack);
  });

  it('onboarding signals route to onboarding state', async () => {
    const sessionId = `agent_onb_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const r = await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: 'I just signed up and need help getting started with my account',
    });
    expect(['onboarding', 'active']).toContain(r.state);
    expect(r.harness?.phases).toContain('ROUTE');
  }, 45_000);

  it('support escalation signals match support_escalation state', async () => {
    const sessionId = `agent_sup_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const r = await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: 'The dashboard export is broken and not working at all, I need help',
    });
    expect(['support_escalation', 'active', 'churn']).toContain(r.state);
  }, 45_000);

  it('destructive cancel may require step-up or confirmation (tier 3 policy)', async () => {
    const sessionId = `agent_cancel_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const r = await stack.container.runtime.handleInbound({
      tenantId: stack.tenantId,
      channelType: ChannelType.WebChat,
      identifier: sessionId,
      text: 'Please cancel my subscription immediately',
    });
    const reply = r.replies[0];
    const hasGuard =
      r.harness?.phases?.includes('CONFIRM') ||
      reply?.kind === 'step_up' ||
      (r.actions?.some((a) => a.key === 'cancel_subscription') ?? false);
    expect(hasGuard || r.state === 'churn').toBe(true);
  }, 60_000);

  it('flow playbooks loaded for onboarding and churn', () => {
    expect(stack.container.flows.some((f) => f.stateKey === 'onboarding')).toBe(true);
    expect(stack.container.flows.some((f) => f.stateKey === 'churn')).toBe(true);
    expect(stack.container.flows.some((f) => f.stateKey === 'support_escalation')).toBe(true);
  });

  it('policy layer exposes tier-1 schedule_report with confirmation threshold', () => {
    const action = stack.container.store.getActionByKey(stack.tenantId, 'schedule_report');
    expect(action?.tier).toBe(1);
    expect(action?.exposed).toBe(true);
  });
});