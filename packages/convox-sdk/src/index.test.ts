import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AelioConvox, signIdentity, verifyExecuteToken, verifyIdentityToken } from './index.js';
import { MockAelioServer } from './testing/mock-server.js';

const TENANT = 'acme';
const API_KEY = 'test_api_key';

describe('@aelio/convox-sdk', () => {
  let server: MockAelioServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new MockAelioServer({ apiKeys: { [TENANT]: API_KEY } });
    await server.listen(0);
    baseUrl = server.url;
  });

  afterEach(async () => {
    await server.close();
  });

  it('connects and registers tools on the Convox stream', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.tool('get_account_status', {
      description: 'Get plan and seats',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ plan: 'pro', seats: 5 }),
    });

    await convox.connect();
    expect(convox.isReady).toBe(true);
    expect(convox.isConnected).toBe(true);
    expect(server.toolsForTenant(TENANT)).toHaveLength(1);
    expect(server.toolsForTenant(TENANT)[0]?.key).toBe('get_account_status');

    await convox.disconnect();
  });

  it('pushes tool_upsert when a tool is added after connect', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    await convox.connect();

    convox.tool('schedule_report', {
      description: 'Schedule a report',
      inputSchema: {
        type: 'object',
        properties: { report: { type: 'string' }, recipient: { type: 'string' } },
        required: ['report', 'recipient'],
      },
      handler: async (_ctx, args) => ({ scheduled: true, ...args }),
    });

    await new Promise((r) => setTimeout(r, 50));
    const keys = server.toolsForTenant(TENANT).map((t) => t.key);
    expect(keys).toContain('schedule_report');
    await convox.disconnect();
  });

  it('removes tools from the server catalog', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.tool('temp_tool', {
      description: 'Temporary',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ ok: true }),
    });
    await convox.connect();

    convox.removeTool('temp_tool');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.toolsForTenant(TENANT)).toHaveLength(0);
    await convox.disconnect();
  });

  it('executes a handler and returns the result to the server', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.tool('update_plan', {
      description: 'Change plan',
      inputSchema: {
        type: 'object',
        properties: { plan: { type: 'string' } },
        required: ['plan'],
      },
      handler: async (ctx, args) => ({
        userId: ctx.externalUserId,
        plan: (args as { plan: string }).plan,
      }),
    });

    await convox.connect();

    const result = await server.execute(TENANT, {
      tool: 'update_plan',
      args: { plan: 'starter' },
      apiKey: API_KEY,
      context: {
        invocationId: 'inv_test_1',
        tenantId: TENANT,
        externalUserId: 'user_42',
        verified: true,
        stepUpValid: false,
      },
    });

    expect(result).toEqual({ userId: 'user_42', plan: 'starter' });
    await convox.disconnect();
  });

  it('signs identity assertions as url-safe tokens', () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    const assertion = {
      sessionId: 'aelio_sess_abc',
      userId: 'user_42',
      email: 'alex@example.com',
    };
    const token = convox.signIdentity(assertion);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(2);

    const again = signIdentity(TENANT, API_KEY, assertion);
    expect(again).toBe(token);

    const verified = verifyIdentityToken(token, API_KEY);
    expect(verified.tenantId).toBe(TENANT);
    expect(verified.sessionId).toBe(assertion.sessionId);
    expect(verified.userId).toBe(assertion.userId);
    expect(verified.email).toBe(assertion.email);
  });

  it('returns an execute_error when the tool is not registered', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    await convox.connect();

    await expect(
      server.execute(TENANT, {
        tool: 'missing_tool',
        args: {},
        apiKey: API_KEY,
        context: {
          invocationId: 'inv_missing',
          tenantId: TENANT,
          externalUserId: 'user_1',
          verified: true,
          stepUpValid: false,
        },
      }),
    ).rejects.toThrow(/No handler registered/);

    await convox.disconnect();
  });

  it('registers flows and policies on connect', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.tool('get_account_status', {
      description: 'Get plan',
      inputSchema: { type: 'object', properties: {} },
      policy: { tier: 0, exposed: true },
      handler: async () => ({ plan: 'pro' }),
    });
    convox.flow({
      stateKey: 'onboarding',
      objectiveKey: 'choose_plan',
      approved: true,
      steps: [
        { order: 1, prompt: 'Ask about plan needs.' },
        { order: 2, toolKey: 'get_account_status' },
      ],
    });

    await convox.connect();

    const tools = server.toolsForTenant(TENANT);
    expect(tools[0]?.policy).toEqual({ tier: 0, exposed: true });

    const flows = server.flowsForTenant(TENANT);
    expect(flows).toHaveLength(1);
    expect(flows[0]?.stateKey).toBe('onboarding');
    expect(flows[0]?.objectiveKey).toBe('choose_plan');

    await convox.disconnect();
  });

  it('pushes flow_upsert when a flow is added after connect', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    await convox.connect();

    convox.flow({
      stateKey: 'churn',
      objectiveKey: 'offer_retention',
      steps: [{ order: 1, prompt: 'Understand churn reason.' }],
    });

    await new Promise((r) => setTimeout(r, 50));
    const flows = server.flowsForTenant(TENANT);
    expect(flows.some((f) => f.objectiveKey === 'offer_retention')).toBe(true);
    await convox.disconnect();
  });

  it('removes flows from the server catalog', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.flow({
      stateKey: 'temp',
      objectiveKey: 'temp_obj',
      steps: [{ order: 1, prompt: 'temp' }],
    });
    await convox.connect();

    convox.removeFlow('temp', 'temp_obj');
    await new Promise((r) => setTimeout(r, 50));
    expect(server.flowsForTenant(TENANT)).toHaveLength(0);
    await convox.disconnect();
  });

  it('verifyExecuteToken rejects tampered tokens', () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    const token = convox.signIdentity({ sessionId: 's1', userId: 'u1' });
    expect(() =>
      verifyExecuteToken(token, API_KEY, {
        invocationId: 'inv',
        tenantId: TENANT,
        tool: 'any',
      }),
    ).toThrow();
  });

  it('rejects unsigned execute payloads', async () => {
    const convox = new AelioConvox({ tenantId: TENANT, apiKey: API_KEY, aelioBaseUrl: baseUrl });
    convox.tool('get_account_status', {
      description: 'Get plan',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({ plan: 'pro' }),
    });

    await convox.connect();
    const conn = server.listConnections()[0];
    expect(conn).toBeTruthy();

    const result = await new Promise<{ type?: string; error?: { code?: string; message?: string } }>((resolve) => {
      const onMessage = (data: import('ws').RawData) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const parsed = JSON.parse(text) as {
          type?: string;
          invocationId?: string;
          error?: { code?: string; message?: string };
        };
        if (parsed.invocationId !== 'inv_unsigned') return;
        conn?.ws.off('message', onMessage);
        resolve(parsed);
      };
      conn?.ws.on('message', onMessage);
      conn?.ws.send(
        JSON.stringify({
          type: 'execute',
          invocationId: 'inv_unsigned',
          tool: 'get_account_status',
          args: {},
          context: {
            invocationId: 'inv_unsigned',
            tenantId: TENANT,
            externalUserId: 'user_1',
            verified: true,
            stepUpValid: false,
          },
        }),
      );
    });

    expect(result.type).toBe('execute_error');
    expect(result.error?.code).toBe('unauthorized');
    expect(result.error?.message).toMatch(/Missing execute token/);
    await convox.disconnect();
  });
});
