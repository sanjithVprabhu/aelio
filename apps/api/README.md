# @aelio/api

The Aelio runtime server. Hosts the admin/runtime REST API, the magic‑link and
step‑up verification pages, the live web‑chat ingress, and serves the three
designed product pages.

```bash
pnpm --filter @aelio/api dev    # watch mode on :3000
pnpm --filter @aelio/api demo   # headless cross-layer scenario walk
pnpm --filter @aelio/api test   # vitest
```

## Layout (mirrors the manual's six layers)

| Dir | Layer | Responsibility |
|---|---|---|
| `channel/` | L2 | Normalize provider payloads (WhatsApp/web/voice) → internal `InboundContext` |
| `identity/` | L3 | Identity, magic link, sessions, step‑up, cross‑channel stitching |
| `playbook/` | L4 | State inference, triggers, fallback ladder, default playbook bootstrap |
| `agent/` | L4 | Context builder + tool loop + the runtime critical‑path orchestrator |
| `integration/` | L5 | Spec ingestion, OpenAPI parser, tier inference, action definitions |
| `policy/` | L5 | The seven policy gates, TOCTOU confirmation, step‑up, auth proxy, mock SaaS |
| `store/` | — | In‑memory repositories (tenant‑scoped) + Redis‑like KV with TTL |
| `routes/` | — | Fastify route registration (JSON API + HTML pages) |

`container.ts` wires every service together and seeds the **Acme Analytics** demo
tenant (spec → exposed actions → default playbook → web‑chat channel).

## Key endpoints

```
GET  /healthz · /readyz
POST /api/v1/chat/:slug/message        # the runtime ingress
POST /api/v1/dev/follow                # demo: follow a magic-link / step-up URL inline
GET  /api/v1/t/:slug/actions           # policy surface (tiers, exposure)
GET  /api/v1/t/:slug/playbook          # lifecycle states + triggers
GET  /api/v1/t/:slug/conversations[/:id]
GET  /api/v1/t/:slug/inbox             # escalations
GET  /api/v1/t/:slug/analytics         # summary + state distribution + top actions
GET  /api/v1/t/:slug/audit             # append-only audit trail
POST /api/v1/t/:slug/specs             # ingest an OpenAPI spec
GET  /verify/:token · /step-up/:token  # branded verification pages
GET  /chat                             # live API-backed chat widget
```
