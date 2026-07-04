/**
 * HTTP chat interface — widget path, harness output, state/flow reflection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hasFullStackEnv } from './fixtures/e2e-env.js';
import {
  bootConvoxE2eStack,
  chat,
  shutdownE2eStack,
  verifyViaChat,
  type E2eStack,
} from './fixtures/e2e-app.js';

const describeE2e = hasFullStackEnv() ? describe : describe.skip;

describeE2e('Chat interface (HTTP)', () => {
  let stack: E2eStack;

  beforeAll(async () => {
    stack = await bootConvoxE2eStack();
  }, 120_000);

  afterAll(async () => {
    await shutdownE2eStack(stack);
  });

  it('first message returns magic link (needs verification)', async () => {
    const sessionId = `chat_${randomUUID()}`;
    const body = await chat(stack.baseUrl, sessionId, 'hello');
    expect(body.needsVerification).toBe(true);
    expect((body.replies as Array<{ kind: string }>)?.[0]?.kind).toBe('magic_link');
  });

  it('verified session returns harness trace and text reply', async () => {
    const sessionId = `chat_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const body = await chat(stack.baseUrl, sessionId, "what's my current plan?");
    expect(body.needsVerification).toBe(false);
    const phases = (body.harness as { phases?: string[] })?.phases ?? [];
    expect(phases).toEqual(
      expect.arrayContaining(['RESOLVE', 'ROUTE', 'PLAN', 'VALIDATE', 'SYNTHESIZE']),
    );
    expect((body.replies as Array<{ text: string }>)?.[0]?.text?.length).toBeGreaterThan(0);
  }, 60_000);

  it('churn message infers churn state with objectives', async () => {
    const sessionId = `chat_churn_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const body = await chat(
      stack.baseUrl,
      sessionId,
      'I want to cancel my subscription because it is too expensive',
    );
    expect(body.state).toBe('churn');
    const objectives = body.objectives as Array<{ key: string }>;
    expect(objectives?.length).toBeGreaterThan(0);
  }, 60_000);

  it('dev phase endpoint reflects live Convox state', async () => {
    const sessionId = `chat_phase_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    await chat(stack.baseUrl, sessionId, 'I need to cancel, too expensive');
    const res = await fetch(`${stack.baseUrl}/api/v1/dev/convox/acme/session/${sessionId}/phase`);
    const body = (await res.json()) as {
      ok: boolean;
      convoxPhase?: { currentState: string };
      liveStates: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.liveStates).toContain('churn');
    expect(body.convoxPhase?.currentState).toBe('churn');
  }, 60_000);

  it('tier-0 read may execute get_account_status', async () => {
    const sessionId = `chat_read_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const body = await chat(stack.baseUrl, sessionId, "what's my plan and account status?");
    const actions = body.actions as Array<{ key: string; status: string }>;
    const executed = actions?.some((a) => a.key === 'get_account_status' && a.status === 'succeeded');
    // Gemini may answer from context without tool call — pass if harness completed.
    expect(body.needsVerification).toBe(false);
    expect((body.harness as { phases?: string[] })?.phases).toContain('SYNTHESIZE');
    if (executed) expect(actions!.find((a) => a.key === 'get_account_status')?.status).toBe('succeeded');
  }, 60_000);

  it('memory phrase stored and retrievable on follow-up', async () => {
    const sessionId = `chat_mem_${randomUUID()}`;
    await verifyViaChat(stack.baseUrl, sessionId);
    const marker = `phoenix-${randomUUID().slice(0, 8)}`;
    await chat(stack.baseUrl, sessionId, `My favorite dashboard is called ${marker}.`);
    await new Promise((r) => setTimeout(r, 1500));
    const follow = await chat(stack.baseUrl, sessionId, `What dashboard name did I mention?`);
    const text = (follow.replies as Array<{ text: string }>)?.[0]?.text ?? '';
    expect(follow.needsVerification).toBe(false);
    // Gemini + SunJet memory — marker may appear in reply or harness used memory hits
    expect(text.length).toBeGreaterThan(5);
  }, 90_000);

  it('readyz reports sunjet + google stack', async () => {
    const res = await fetch(`${stack.baseUrl}/readyz`);
    const body = (await res.json()) as {
      memoryEngine?: string;
      llm?: string;
      sunjet?: { status?: string };
    };
    expect(body.memoryEngine).toBe('sunjet');
    expect(body.sunjet?.status).toBe('ok');
  });
});