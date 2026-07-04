/**
 * Convox SDK catalog sync — tools, states, flows, policies over WebSocket.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ActionTier } from '@aelio/types';
import { hasFullStackEnv } from './fixtures/e2e-env.js';
import {
  DEMO_CATALOG_FLOWS,
  DEMO_CATALOG_STATES,
  DEMO_CATALOG_TOOLS,
} from './fixtures/demo-catalog.js';
import { bootConvoxE2eStack, shutdownE2eStack, type E2eStack } from './fixtures/e2e-app.js';

const describeE2e = hasFullStackEnv() ? describe : describe.skip;

describeE2e('Convox catalog sync (SDK → server)', () => {
  let stack: E2eStack;

  beforeAll(async () => {
    stack = await bootConvoxE2eStack();
  }, 120_000);

  afterAll(async () => {
    await shutdownE2eStack(stack);
  });

  it('registers all 8 tools over WebSocket', () => {
    const keys = stack.container.convox.listTools(stack.tenantId).map((t) => t.key);
    for (const t of DEMO_CATALOG_TOOLS) expect(keys).toContain(t.key);
  });

  it('syncs tool policies into the policy layer', () => {
    for (const t of DEMO_CATALOG_TOOLS) {
      const action = stack.container.store.getActionByKey(stack.tenantId, t.key);
      expect(action).toBeTruthy();
      expect(action!.tier).toBe(t.expectedTier);
      if (t.definition.policy?.stepUpRequired) {
        expect(action!.stepUpRequired).toBe(true);
      }
    }
    const cancel = stack.container.store.getActionByKey(stack.tenantId, 'cancel_subscription');
    expect(cancel?.tier).toBe(ActionTier.Destructive);
    expect(cancel?.rateLimitPerUserPerHour).toBe(3);
  });

  it('registers all 4 guided states with objectives', () => {
    const keys = stack.container.convox.listStates(stack.tenantId).map((s) => s.key);
    for (const s of DEMO_CATALOG_STATES) expect(keys).toContain(s.key);
    const churn = stack.container.convox.listStates(stack.tenantId).find((s) => s.key === 'churn');
    expect(churn?.objectives?.length).toBeGreaterThan(0);
  });

  it('registers all 3 flows and loads them into runtime', () => {
    const flows = stack.container.convox.listFlows(stack.tenantId);
    expect(flows.length).toBeGreaterThanOrEqual(3);
    for (const f of DEMO_CATALOG_FLOWS) {
      expect(
        flows.some((x) => x.stateKey === f.stateKey && x.objectiveKey === f.objectiveKey),
      ).toBe(true);
    }
    expect(stack.container.flows.length).toBeGreaterThanOrEqual(3);
  });

  it('reflects catalog on dev inspection endpoint', async () => {
    const res = await fetch(`${stack.baseUrl}/api/v1/dev/convox/acme/tools`);
    const body = (await res.json()) as {
      liveTools: Array<{ key: string; policy?: { tier?: number } }>;
      liveStates: Array<{ key: string }>;
      liveFlows: Array<{ stateKey: string; objectiveKey: string }>;
      policies: Array<{ key: string; tier: number }>;
      approvedFlows: Array<{ stateKey: string; objectiveKey: string }>;
    };
    expect(body.liveTools.length).toBeGreaterThanOrEqual(8);
    expect(body.liveStates.length).toBeGreaterThanOrEqual(4);
    expect(body.liveFlows.length).toBeGreaterThanOrEqual(3);
    expect(body.policies.find((p) => p.key === 'cancel_subscription')?.tier).toBe(3);
    expect(body.approvedFlows.some((f) => f.stateKey === 'onboarding')).toBe(true);
  });

  it('pushes tool_upsert after connect for a new tool', async () => {
    stack.convox.tool('e2e_temp_tool', {
      description: 'Temporary E2E tool',
      inputSchema: { type: 'object', properties: {} },
      policy: { tier: 0 },
      handler: async () => ({ ok: true }),
    });
    await new Promise((r) => setTimeout(r, 300));
    stack.container.convoxBridge.syncFromRegistry(stack.tenantId);
    expect(
      stack.container.convox.listTools(stack.tenantId).some((t) => t.key === 'e2e_temp_tool'),
    ).toBe(true);
    stack.convox.removeTool('e2e_temp_tool');
  });

  it('pushes flow_upsert for a new playbook', async () => {
    stack.convox.flow({
      stateKey: 'active',
      objectiveKey: 'e2e_flow_probe',
      approved: true,
      steps: [{ order: 1, prompt: 'E2E flow probe step' }],
    });
    await new Promise((r) => setTimeout(r, 400));
    const flows = stack.container.convox.listFlows(stack.tenantId);
    expect(flows.some((f) => f.objectiveKey === 'e2e_flow_probe')).toBe(true);
    stack.convox.removeFlow('active', 'e2e_flow_probe');
  });
});