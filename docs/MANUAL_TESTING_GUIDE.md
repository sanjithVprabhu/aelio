# Aelio Manual Testing Guide

This guide is for manually verifying the Aelio flow end to end with a bound
customer backend and per-turn telemetry.

## What You Are Testing

You are manually verifying this path:

1. customer frontend loads the widget
2. widget creates a session
3. customer backend signs identity with `Convox SDK`
4. widget sends identity to `Aelio Server`
5. user sends a message
6. Aelio resolves intent/state/flow/policy
7. Aelio calls customer tools when needed
8. customer backend executes tool handlers
9. Aelio returns a conversational reply
10. telemetry shows the turn details

## Pages To Use

### `/chat`

Use `/chat` as the real customer-style integration page.

This page uses:

- the widget SDK
- the customer backend identity token flow
- the Aelio server chat ingress

### `/demo/telemetry`

Use `/demo/telemetry` to inspect each message turn visually.

This page now uses the same signed identity path as the customer flow and
shows per-turn details including:

- sender
- tenant
- session / identifier
- identity id
- conversation id
- replied-by (`agent` or `system`)
- intent
- state
- flow
- tool calls
- harness phases

### `/demo/live`

Use `/demo/live` to inspect the mock SaaS state changing over time.

This is useful for verifying that tool calls actually changed backend data.

## Local Demo Stack

For the demo customer backend flow:

1. build the widget SDK
2. start the Aelio server
3. start the demo customer backend

Typical commands:

```bash
pnpm widget:build
pnpm api:live
pnpm demo:backend:live
```

Then open:

```text
http://localhost:3000/chat
http://localhost:3000/demo/telemetry
http://localhost:3000/demo/live
```

## What To Verify Per Message

For every manual test message, verify:

1. `sender`
   Confirm whether the reply came from `system` or `agent`.
   Example: verification link replies should show `system`.

2. `tenant`
   Confirm the tenant slug and tenant id are correct for the active chat.

3. `session / identifier`
   Confirm the same widget session is being used across turns.

4. `identity`
   Confirm identity is bound after signed customer identification.
   You should see identity id and conversation id.

5. `intent`
   Confirm the runtime inferred the expected intent, with args if present.

6. `state`
   Confirm the expected state is active.
   Examples: `active`, `onboarding`, `churn`.

7. `flow`
   If the turn is part of a guided objective, confirm the flow and active step
   make sense.

8. `tool calls`
   Confirm whether a tool was called, which tool, which tier, and whether it
   succeeded.

9. `harness phases`
   Confirm the turn passed through the expected runtime phases.

## Suggested Manual Test Prompts

Use these prompts in order.

### 1. Identity / First Contact

```text
hello
```

Verify:

- session exists
- identity gets bound through the signed backend flow
- telemetry shows tenant/session/identity context

### 2. Read Tool Call

```text
what's my plan?
```

Verify:

- state is `active`
- `get_account_status` may run
- tool call is shown in telemetry
- reply matches tool result

### 3. Onboarding State

```text
I just signed up, help me get started
```

Verify:

- state becomes `onboarding`
- objectives appear
- flow appears if applicable

### 4. Guided Action

```text
schedule the sales report to my manager weekly
```

Verify:

- appropriate intent inferred
- `schedule_report` tool call shown
- flow/objective progression updates
- `/demo/live` reflects backend state change

### 5. Reversible Change

```text
downgrade me to starter
```

Verify:

- confirmation or tier behavior is correct
- `update_plan` appears when executed
- backend state changes correctly

### 6. Destructive Flow

```text
I want to cancel my subscription
```

Verify:

- state becomes `churn`
- retention flow/objectives appear
- destructive policy behavior is visible

## Testing With Your Own APIs

To manually test with your own backend APIs:

1. use `@aelio/convox-sdk` in your backend
2. replace demo tool registrations with your own
3. register your own:
   - tools
   - states
   - flows
   - policy metadata
4. add an identity-token endpoint on your backend
5. point the widget at your backend for identity token minting
6. point the widget at the Aelio server for chat transport

Conceptually:

```ts
const convox = new AelioConvox({
  tenantId: 'your-tenant-slug',
  apiKey: process.env.AELIO_API_KEY!,
  aelioBaseUrl: process.env.AELIO_BASE_URL!,
});

convox.tool('get_order_status', { ... });
convox.tool('refund_order', { ... });
convox.state('support', { ... });
convox.flow({ ... });

await convox.connect();
```

Then your frontend widget should use:

- Aelio for `/api/v1/chat/:slug/message`
- your backend for the identity token

## Success Criteria

Manual verification is successful when:

1. the widget works through the customer backend identity path
2. tool calls execute against the bound backend
3. backend state changes are visible
4. telemetry clearly shows each turn’s runtime decision trail
5. you can explain why the agent did what it did for every message
