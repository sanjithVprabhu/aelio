# @aelio/widget-sdk

The embeddable web-chat widget for **Aelio.** — a dependency-free (~30KB),
shadow-DOM-isolated chat launcher + panel that SaaS customers drop onto their
own site. It owns a per-visitor session, talks to the Aelio chat API, and
renders text replies plus actionable `magic_link` / `step_up` buttons.

## Why shadow DOM?

All markup and styles live inside a shadow root (`:host { all: initial }`), so
the widget can never inherit or leak host-page CSS. Everything is vanilla DOM —
no React, no runtime dependencies.

## Install (embed via module script)

The simplest no-framework integration is a module script. Configuration is read
from `data-*` attributes and the widget auto-initializes:

```html
<script
  type="module"
  src="https://cdn.aelio.com/aelio-widget/embed.js"
  data-tenant="acme"
  data-api="https://api.aelio.com"
  data-accent="#0A0A0A"
  data-name="Acme Support"
  data-launcher="Chat with us"
></script>
```

| Attribute       | Required | Description                                     |
| --------------- | -------- | ----------------------------------------------- |
| `data-tenant`   | yes      | Your Aelio tenant slug.                          |
| `data-api`      | yes      | Base URL of the Aelio API.                       |
| `data-accent`   | no       | Accent color (any CSS color). Defaults to black.|
| `data-name`     | no       | Panel header title. Defaults to `Aelio.`        |
| `data-launcher` | no       | Launcher button label. Defaults to `Chat`.      |

## Install (programmatic / bundler)

```ts
import { initAelio } from '@aelio/widget-sdk';

const widget = initAelio({
  tenantSlug: 'acme',
  apiBaseUrl: 'https://api.aelio.com',
  identityTokenProvider: async (sessionId) => {
    const res = await fetch('/api/aelio/identity-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json();
    return json.identityToken as string;
  },
  accentColor: '#0A0A0A', // optional
  widgetName: 'Acme Support', // optional
  launcherText: 'Chat with us', // optional
  container: '#support-chat', // optional
  inline: true, // optional
});

widget.open();
widget.send('Hello!');
```

When loaded via `@aelio/widget-sdk/embed`, the factory is exposed as
`window.initAelio(...)` and the live instance as
`window.AelioWidget`.

## API

### `initAelio(config): AelioWidget`

Creates and mounts the widget. `config`:

```ts
interface AelioConfig {
  tenantSlug: string;
  apiBaseUrl: string;
  identityToken?: string;
  identityTokenProvider?: (sessionId: string) => string | null | Promise<string | null>;
  accentColor?: string;
  widgetName?: string;
  launcherText?: string;
  container?: string | HTMLElement;
  inline?: boolean;
}
```

### `AelioWidget`

| Method               | Description                              |
| -------------------- | ---------------------------------------- |
| `open()` / `close()` | Show / hide the chat panel.              |
| `toggle()`           | Toggle the panel.                        |
| `identify(token)`    | Bind the visitor session to a signed user identity. |
| `send(text)`         | Send a message programmatically.         |
| `getSessionId()`     | The persisted visitor session id.        |
| `destroy()`          | Unmount and release references.          |

## Build output

```bash
pnpm --filter @aelio/widget-sdk build
```

This emits:

- `dist/index.js` / `dist/index.d.ts`
- `dist/embed.js` / `dist/embed.d.ts`

Use `dist/index.js` for bundler/programmatic integration and `dist/embed.js`
for direct browser module-script embedding.

## Protocol

Messages are POSTed to:

```
POST ${apiBaseUrl}/api/v1/chat/${tenantSlug}/message
{ "sessionId": "aelio_sess_…", "text": "…" }
```

If you want the widget bound to a known customer account, first mint a signed
identity token on your backend with `@aelio/convox-sdk` and let the widget send
it to:

```text
POST ${apiBaseUrl}/api/v1/chat/${tenantSlug}/identify
{ "identityToken": "…" }
```

The recommended production pattern is `identityTokenProvider(sessionId)`, so
the browser asks your backend for a short-lived token and never holds your
Convox signing key.

Expected response:

```jsonc
{
  "replies": [
    { "kind": "text", "text": "Hi there!" },
    { "kind": "magic_link", "text": "Tap to sign in", "url": "https://…" }
  ],
  "state": "verifying",
  "actions": ["resend"],
  "needsVerification": true
}
```

`reply.kind` is one of `text | magic_link | step_up | handoff`. `magic_link`
and `step_up` render an action button that opens `reply.url` in a new tab.

## Session handling

A per-visitor `sessionId` is generated (`crypto.randomUUID` when available) and
persisted in `localStorage` under `aelio:sessionId`, so the conversation thread
survives page reloads.

## Development

```bash
pnpm --filter @aelio/widget-sdk typecheck
pnpm --filter @aelio/widget-sdk test
```

The DOM-independent logic (session ids, reply classification, HTML escaping,
bubble/state markup, endpoint composition) is exported as pure functions and
unit-tested without a DOM.
