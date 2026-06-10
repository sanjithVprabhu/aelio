# Aelio — Conversational intelligence for SaaS platforms

> _The best butler doesn't wait to be asked._

Aelio is a B2B2C conversational-AI platform. A legacy SaaS company points Aelio at
their API; their customers then **talk** to the product — on WhatsApp, voice, web
chat, SMS, Slack — and Aelio safely **acts** on their behalf instead of making them
navigate a UI.

```
Spec in  ─▶  tiered, policy-gated actions  ─▶  agent that converses + acts  ─▶  Interface out
```

This is a from-scratch build of the platform described in
[`Reference/BUILD_MANUAL_AELIO.md`](Reference/BUILD_MANUAL_AELIO.md) — all six
layers, five deployable apps, the embeddable widget, the admin dashboard, and
infrastructure-as-code. It runs **end-to-end with zero external infrastructure**
(in-memory persistence + a deterministic scripted LLM + in-process provider
mocks), and lights up the production paths when you supply real backends.

**82 tests pass** across the monorepo; `turbo typecheck`, `turbo test`, and
`turbo build` (including the Next.js admin build) are all green.

---

## Quick start

```bash
pnpm install
pnpm --filter @aelio/api dev        # the runtime + admin API + 4 served pages → :3000
```

Open:

| URL | What it is |
|---|---|
| `/` | **Landing page** (designed marketing surface) |
| `/onboarding` | **Onboarding** flow (auth → connect spec → channels → live) |
| `/app` | **Workflow / dashboard** (designed admin surface) |
| `/chat` | **Live chat** wired to the real runtime |
| `/healthz` `/readyz` | health |

Run the headless cross-layer demo and the eval suite:

```bash
pnpm --filter @aelio/api demo        # magic-link → Tier-0 read → retention trigger → Tier-3 step-up → Tier-2 change
pnpm --filter @aelio/api start &     # then, against the live api:
API_BASE_URL=http://localhost:3000 pnpm --filter @aelio/eval-runner run   # 3/3, exits 0
```

The richer **Next.js dashboard** (separate app) talks to the same API:

```bash
pnpm --filter @aelio/api dev &       # :3000
pnpm --filter @aelio/admin dev       # :3001 — Dashboard, Conversations, Users, Audit,
                                     #         Playbooks, Actions, Channels, Settings, Playground
```

Channel + voice workers (point real WhatsApp/Twilio/Slack webhooks at them):

```bash
API_BASE_URL=http://localhost:3000 pnpm --filter @aelio/channel-worker dev   # :3100
API_BASE_URL=http://localhost:3000 pnpm --filter @aelio/voice-worker dev     # :3200
```

---

## The two moats (built deeply)

**Capability moat — the Policy layer** ([`apps/api/src/policy`](apps/api/src/policy)).
Every tool call the agent makes passes through **seven gates** in
[`policy-service.ts`](apps/api/src/policy/policy-service.ts): exposure ·
permissions · schema · arg constraints · pre-conditions · per-user rate limit ·
**tier confirmation (TOCTOU-locked args)** · **step-up** for Tier 3. The
four-tier action model (`Read · ReversibleWrite · StateUpdate · Destructive`) is
inferred from the spec; the **auth proxy** always calls the SaaS with the **end
user's own scoped token**, never a platform master key. Prompt injection cannot
bypass any of this — proven by an eval scenario and a unit test.

**Behavior moat — the Playbook layer** ([`apps/api/src/playbook`](apps/api/src/playbook)).
State inference · per-state behavior bundles · triggers (AND/OR) · fallback
ladder · gradual/shadow rollout (deterministic per-user bucketing). The runtime
orchestrator ([`agent/runtime.ts`](apps/api/src/agent/runtime.ts)) stitches every
layer together on each inbound message, with RAG retrieval, working/long-term
memory, and per-turn telemetry.

---

## Monorepo layout

```
apps/
  api/             # Core runtime + admin API + verification/chat pages + internal mesh
  admin/           # Next.js 15 dashboard (App Router) — the full admin surface
  channel-worker/  # WhatsApp/SMS/Slack webhooks → normalize → ingest → deliver
  voice-worker/    # Twilio TwiML + media-stream WS + voice OTP (mock STT/TTS)
  eval-runner/     # Drives eval suites over HTTP; gates CI
packages/
  types/  config/  logger/  errors/  crypto/   # cross-cutting foundations
  llm/             # provider-agnostic client (Scripted + Anthropic)
  db/              # Drizzle Postgres schema + append-only audit triggers
  queue/           # BullMQ-style durable-job abstraction (in-memory impl)
  widget-sdk/      # embeddable shadow-DOM web-chat SDK
infra/
  docker/  k8s/  terraform/  runbooks/         # Dockerfiles, manifests, IaC, 10 runbooks + DR
docs/              # SECURITY.md, OBSERVABILITY.md
Reference/         # the build manual + the three HTML page mocks
```

`apps/api` mirrors the manual's six layers: `channel/` (L2) · `identity/` (L3) ·
`playbook/` + `agent/` + `kb/` (L4) · `integration/` + `policy/` (L5, audit baked
in) · `routes/` (L6 admin surface).

---

## Default (zero-infra) vs. real backends — both implemented, switched by env

Every real integration is built and wired; set the env var to turn it on
(see [`.env.example`](.env.example)). The default with nothing set runs fully
offline. The real Postgres/Redis/BullMQ paths are **verified live** against Docker.

| Area | Default (no env) | Real backend (set env) | Status |
|---|---|---|---|
| Persistence | In-memory repos | **Postgres** via Drizzle — migrations + write-through + hydrate-on-boot (`DATABASE_URL`) | ✅ verified durable across restart |
| Cache / sessions | In-memory KV | **Redis** (`RedisKv`, `REDIS_URL`) | ✅ verified |
| Queue | In-memory | **BullMQ + Redis** (`createQueueFor`, `REDIS_URL`) | ✅ verified job through Redis |
| LLM | Scripted provider | **Anthropic / OpenAI / Google** (`LLM_PROVIDER` + key) | ✅ clients implemented |
| LLM tracing | structured logs | **Langfuse** ingestion (`LANGFUSE_*`) | ✅ observer wraps every call |
| Tenant SaaS API | in-process `mock://` | real base URL → real HTTP via the auth proxy | ✅ |
| WhatsApp / SMS / Slack | mock outbound + real webhooks/sig-verify | **Meta Cloud API / Twilio / Slack** (`META_*`/`TWILIO_*`/`SLACK_*`) | ✅ providers implemented |
| STT / TTS | mock pass-through | **Deepgram / ElevenLabs** (`DEEPGRAM_API_KEY`/`ELEVENLABS_API_KEY`) | ✅ providers implemented |
| Embeddings / RAG | hashing embedder + cosine + RRF | pgvector column ready in `packages/db` | ◐ real embedder swap is one class |
| Infra | — | Terraform/k8s/Docker as code | ◐ authored, not `apply`-ed (needs cloud) |

Run against real backends:
```bash
docker run -d --name aelio-pg -e POSTGRES_USER=dev -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=aelio_dev -p 5470:5432 pgvector/pgvector:pg16
docker run -d --name aelio-redis -p 6390:6379 redis:7-alpine
DATABASE_URL=postgres://dev:dev@localhost:5470/aelio_dev \
REDIS_URL=redis://localhost:6390 \
  pnpm --filter @aelio/api dev        # migrates, hydrates, then serves
```

**One framework deviation:** `apps/api` uses **Fastify** rather than the manual's
NestJS, chosen for runnability/verifiability. Layer boundaries and contracts are
unchanged.

See [docs/SECURITY.md](docs/SECURITY.md) and [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).

---

## Definition of Done — status

| Manual DoD area | Status |
|---|---|
| All six layers implemented | ✅ L2–L6 + audit |
| Five deployable apps | ✅ api, admin, channel-worker, voice-worker, eval-runner |
| Shared packages | ✅ types, config, logger, errors, crypto, llm, db, queue, widget-sdk |
| Tenant isolation everywhere | ✅ enforced in the store |
| Audit append-only | ✅ store + DB triggers |
| Four-tier policy + TOCTOU + step-up | ✅ + tests |
| Auth proxy uses end-user token | ✅ |
| Magic link / sessions / step-up / stitching | ✅ + tests |
| State inference / triggers / fallback / RAG / memory | ✅ + tests |
| Spec ingestion (OpenAPI/Postman/GraphQL/MCP/raw) | ✅ + tests |
| Admin surface (onboarding, playbook deploy, policy editor, KB, inbox, analytics, evals, settings, GDPR) | ✅ |
| Channels (WhatsApp/SMS/Slack/voice) + sig verify + dedup + rate limit + OTP | ✅ verified end-to-end |
| Eval harness + replay + prompt-injection cases | ✅ gates CI |
| Embeddable widget SDK | ✅ + tests |
| Infra: Terraform, k8s, Docker, 10 runbooks + DR | ✅ as code |
| Observability + security posture | ✅ docs + hooks |
| CI: typecheck, test, build, demo, eval gate | ✅ green |
| Real Postgres + Redis + BullMQ paths | ✅ implemented & verified against Docker |
| Real LLM (Anthropic/OpenAI/Google) + Langfuse + channel/voice transports | ✅ implemented, env-activated (need provider keys to run) |
| Voice latency <800ms / multi-region `terraform apply` / SOC2 evidence | ⛔ needs real telephony + cloud accounts |

© 2026 UNIQ Global Labs Pvt. Ltd.
