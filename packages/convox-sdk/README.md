# @aelio/convox-sdk

Customer-side **Convox SDK** for Aelio. Install it in your backend to:

- Register tools in code (MCP-style function definitions + handlers)
- Keep a **live catalog** synced to the Aelio server over an outbound WebSocket
- Execute tool calls **in-process** when the Aelio brain invokes them
- Sign **identity assertions** that bind widget sessions to your logged-in users

The Aelio server exposes `/v1/convox/stream` in `apps/api`. For local Mode B testing, run `pnpm --filter @aelio/demo-customer-backend dev` alongside the API.

## Install

```bash
pnpm add @aelio/convox-sdk
```

## Quick start

```ts
import { AelioConvox } from '@aelio/convox-sdk';

const convox = new AelioConvox({
  tenantId: 'acme',
  apiKey: process.env.AELIO_API_KEY!,
  aelioBaseUrl: process.env.AELIO_BASE_URL ?? 'https://api.aelio.com',
});

convox.tool('get_account_status', {
  description: 'Get the current plan, seats, and renewal date',
  inputSchema: { type: 'object', properties: {} },
  handler: async (ctx) => {
    return billing.getAccountStatus(ctx.externalUserId);
  },
});

convox.tool('update_plan', {
  description: 'Change the subscription plan',
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', enum: ['starter', 'pro', 'business'] },
    },
    required: ['plan'],
  },
  handler: async (ctx, { plan }) => {
    return billing.changePlan(ctx.externalUserId, plan);
  },
});

await convox.connect();
```

### Dynamic catalog

Tools added or removed after `connect()` push deltas immediately:

```ts
convox.tool('new_feature', { /* ... */ }); // → tool_upsert
convox.removeTool('deprecated_action');   // → tool_remove
```

On reconnect the SDK sends a full `register` frame with the entire catalog.

### States, flows, and policies

Register conversation phases, objective playbooks, and per-tool policy overrides:

```ts
import { registerDemoSaasStates, registerDemoSaasFlows } from '@aelio/demo-saas';

convox.state('onboarding', {
  description: 'New customer setup',
  guidance: 'Help them pick a plan and invite a teammate.',
  objectives: [{ key: 'choose_plan', description: 'Select a plan', satisfiedByTool: 'update_plan' }],
});

convox.flow({
  stateKey: 'onboarding',
  objectiveKey: 'choose_plan',
  steps: [
    { order: 1, prompt: 'Ask which plan fits their team.' },
    { order: 2, toolKey: 'get_account_status' },
    { order: 3, toolKey: 'update_plan' },
  ],
});

convox.tool('cancel_subscription', {
  description: 'Cancel at period end',
  inputSchema: { type: 'object', properties: {} },
  policy: { tier: 3, stepUpRequired: true, rateLimitPerUserPerHour: 3 },
  handler: async (ctx) => billing.cancel(ctx.externalUserId),
});

registerDemoSaasStates(convox);
registerDemoSaasFlows(convox);
```

## Identity binding (zero-friction auth)

When a user is already logged into your app, sign an assertion from your backend:

```ts
// Your API route — user is authenticated via your normal session
app.post('/api/aelio/identify', (req, res) => {
  const assertion = convox.signIdentity({
    sessionId: req.body.sessionId, // from the embedded widget
    userId: req.user.id,
    email: req.user.email,
  });
  res.json({ assertion });
});
```

The widget forwards `assertion` to Aelio (server endpoint TBD). Tool executes include a signed JWT; handlers receive trusted `ctx.externalUserId`.

## Wire protocol (v1.2)

**Transport:** `wss://<aelio-host>/v1/convox/stream` (outbound from your server)

**Connect headers:**

| Header | Value |
|---|---|
| `Authorization` | `Bearer <tenant_api_key>` |
| `X-Convox-Version` | `1.2.0` |
| `X-Convox-Instance-Id` | Stable per-process id |
| `X-Convox-Tenant-Id` | Tenant slug |

**Client → Aelio:** `register` (tools, states, flows), `tool_upsert`, `tool_remove`, `state_upsert`, `state_remove`, `flow_upsert`, `flow_remove`, `heartbeat`, `execute_result`, `execute_error`

**Aelio → Client:** `registered`, `pong`, `execute`, `error`, `push_event`

See `src/protocol.ts` for typed message shapes.

## Local testing

```ts
import { AelioConvox } from '@aelio/convox-sdk';
import { MockAelioServer } from '@aelio/convox-sdk/testing';

const mock = new MockAelioServer({ apiKeys: { acme: 'test_key' } });
await mock.listen(0);

const convox = new AelioConvox({
  tenantId: 'acme',
  apiKey: 'test_key',
  aelioBaseUrl: mock.url,
});

convox.tool('ping', {
  description: 'Ping',
  inputSchema: { type: 'object', properties: {} },
  handler: async () => ({ pong: true }),
});

await convox.connect();

const result = await mock.execute('acme', {
  tool: 'ping',
  args: {},
  apiKey: 'test_key',
  context: {
    invocationId: 'inv_1',
    tenantId: 'acme',
    externalUserId: 'user_1',
    verified: true,
    stepUpValid: false,
  },
});
```

## Scripts

```bash
pnpm --filter @aelio/convox-sdk typecheck
pnpm --filter @aelio/convox-sdk test
pnpm --filter @aelio/convox-sdk build
```

## Next step (Aelio server)

Implement `/v1/convox/stream` in `apps/api` using the same protocol types, persist the registry per tenant, and route LLM tool calls to connected Convox instances.
