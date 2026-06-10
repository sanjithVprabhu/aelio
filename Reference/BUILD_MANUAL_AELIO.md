# Build Manual — Conversational AI Platform for Legacy SaaS
> **Audience:** Claude Code (and any senior engineer pairing with it)
> **Goal:** A single document Claude Code can read top-to-bottom and use to build the entire platform end-to-end.
> **Status:** v1 — UI section to be populated when the Landing / Onboarding / Workflow HTML mocks are provided.
> **Working title:** TBD (placeholder: `Conduit` — change throughout when name is decided)

---

# Part 0 — How Claude Code should use this manual

## 0.1 What this document is

This is the executable build spec for the entire platform. Every architectural decision, data model, API contract, runtime sequence, test case, and acceptance criterion is in here. If a question arises that this document cannot answer, the answer is to ask the human, not to guess.

The document is organized into:

- **Part 0** — meta (this section): how to read, build sequence, conventions.
- **Part 1** — product overview: what we are building and why.
- **Part 2** — repo bootstrapping: scaffold the monorepo from empty directory to first green CI.
- **Parts 3–8** — the six platform layers, in dependency order. Each layer is a self-contained build spec.
- **Part 9** — UI specifications for the three high-design pages (Landing, Onboarding, Workflow). Populated when the HTML mocks arrive.
- **Part 10** — cross-layer integration: how the layers wire up, integration test strategy, the runtime flow end-to-end.
- **Part 11** — per-app deployable specs: `apps/api`, `apps/admin`, `apps/channel-worker`, `apps/voice-worker`, `apps/eval-runner`.
- **Part 12** — infrastructure & deployment topology.
- **Part 13** — observability, security, compliance posture.
- **Part 14** — build milestones M0 through M6, week-by-week.
- **Part 15** — operational runbooks.
- **Part 16** — global definition of done.

## 0.2 Reading order for Claude Code

Read in this order on first pass:

1. Part 0 (this section) — fully.
2. Part 1 — product context, skim.
3. Part 2 — repo bootstrapping, fully. Execute it. Commit and push. CI should be green before continuing.
4. Part 14 — build milestones. Understand the sequence before reading any single layer.
5. Part 3 (Layer 1) — Foundations. Implement fully. CI green.
6. Part 4 (Layer 2) — Channel. Implement fully. CI green.
7. Part 5 (Layer 3) — Identity. Same.
8. Part 6 (Layer 4) — Playbook & Agent. Same.
9. Part 7 (Layer 5) — Integration & Policy. Same.
10. Part 8 (Layer 6) — Admin & Config. Same.
11. Part 9 — UI (when populated).
12. Part 10 — integration testing across layers.
13. Parts 11–15 — operations, infrastructure, observability.

## 0.3 Conventions

**Definitions of "done" are layered.** A feature is done when:
- All acceptance criteria in its layer doc pass (mechanical check via tests).
- All tests in the layer's test case table pass with ≥80% line coverage on the relevant package.
- The DoD checklist at the end of the layer is fully ticked.
- A runbook exists for the top failure modes of that feature.

**Never invent.** If this document does not specify a behavior, search for it in the layer doc. If it's not there, surface the question rather than guessing. Speculation about business rules is the single biggest source of expensive rework in this kind of platform.

**Tenant isolation is sacred.** Every database query, every Redis key, every queue job, every log line carries `tenantId`. Anywhere this document shows a query without `tenantId` in the where clause, that is a bug — even if it's in this document.

**Secrets are encrypted at rest, masked in logs, masked in API responses.** No exceptions. Anywhere this document shows a plaintext secret in any of those three places, treat as bug.

**Audit logging is append-only.** `audit_events` and `action_invocations` get INSERTs only. UPDATE and DELETE are denied at the database layer via row-level security policy.

**Every external call is wrapped.** HTTP to SaaS APIs goes through the auth proxy. HTTP to LLM providers goes through `packages/llm`. HTTP to channel providers goes through the channel worker. No direct `fetch(...)` calls outside these abstractions.

**TypeScript everywhere.** Backend, frontend, workers, eval runner — all TS. The reasoning is in Part 1. Do not add another language without surfacing the question first.

## 0.4 Source of truth precedence

When two parts of this document conflict (it will happen):

1. The layer-specific section wins over the meta-orchestration. The layer authors thought about it more.
2. The acceptance criteria win over the prose description. They are the testable spec.
3. The data model wins over example code. The example might have a bug; the schema is what runs.
4. The runtime sequence diagram wins over the natural language description.

When the document conflicts with reality — i.e. an external API works differently from how this doc describes it — fix the code to match reality, then update the doc.

## 0.5 Out-of-scope safeguards

These are explicit non-goals for V1. If a feature outside this list is requested, surface the question:

- No multi-language support (English only V1).
- No customer-deployed on-premise option (V2).
- No marketplace of pre-built SaaS integrations (V2).
- No multi-step workflow builder UI (V2; the trigger system covers simple cases in V1).
- No proactive outbound campaigns (the bot is reactive only in V1).
- No voice biometrics (V1.5).
- No fine-tuned per-tenant models (V2).
- No agent performance metrics / SLA management in the inbox (V2).
- No white-labeled magic link verification page on tenant's own domain (V1.5).

---

# Part 1 — Product Overview

## 1.1 What we are building

A B2B2C conversational AI platform. The buyer is a legacy SaaS company. The end user is their customer. We give the SaaS company a way for their customers to interact with their product through WhatsApp, voice, web chat, SMS, Slack, and Teams — without rebuilding the SaaS's UI and without the SaaS having to become an AI company.

The SaaS company brings:
- Their API (as OpenAPI, Postman, GraphQL schema, MCP server, or raw docs).
- Their WhatsApp Business Account, voice numbers, Slack/Teams workspaces — they own the channel.
- Their knowledge base (help docs, PDFs, URLs).
- Their LLM API keys (BYOK) or they use ours (we bill).

We give:
- Spec ingestion, parsing, and policy editor that turns endpoints into safe, tier-gated bot actions.
- A playbook engine that defines lifecycle states, per-state behavior, triggers, and fallbacks.
- A multi-channel runtime that handles inbound and outbound across all supported channels.
- Identity verification via magic link (chat) and OTP (voice), with step-up for sensitive actions.
- A thin agent inbox for human handoff.
- An analytics dashboard and an eval harness for safe iteration.
- The compliance posture (SOC2 in flight from day 1, GDPR controls baked in, HIPAA/PCI on demand).

## 1.2 The two moats

Two layers are colored differently from the rest in the architecture diagram. Both must be built deeply, not shallowly.

**Capability moat — the Policy Layer (Part 7).** Anyone can wire an LLM to an API. Almost no one does the safety layer well. The four-tier action model, the auth proxy that uses the end user's own scoped token, the TOCTOU-protected confirmation flow, the rate limiting per user per action — this is what makes a legacy SaaS CFO sign off on a bot that can write to their database.

**Behavior moat — the Playbook Layer (Part 6).** The LLM provides creative latitude turn-to-turn; the playbook bounds the macro behavior. State inference + per-state behavior bundles + trigger rules + fallback ladder. The bot's behavior is auditable and deterministic at the macro level, even though individual responses are LLM-generated.

## 1.3 Architecture at a glance

Six layers, top-down, each independently scalable:

```
1. Channel Layer        — WhatsApp · Voice · Web · SMS · Slack · Teams
2. Identity & Session   — Magic-link, voice OTP, cross-channel session stitching, step-up
3. Playbook & Agent     — State inference, behavior bundles, triggers, fallbacks, LLM orchestration
4. Integration & Policy — Spec ingestion, action tiers, confirmation gates, auth proxy           [MOAT]
5. Safety & Audit       — Immutable audit logs, PII redaction, replay
6. Admin & Config       — Self-serve product surface, playbook editor, inbox, analytics, evals
```

Note: in the build, layers 4 and 5 from the architecture description are merged. The audit/safety concerns are baked into the Policy Layer code rather than being a separate runtime layer. They appear in this manual as one part (Part 7).

## 1.4 Tech stack — the decisions

| Choice | Decision | Reasoning |
|---|---|---|
| Backend language | TypeScript | Ecosystem fit (every provider SDK is TS-first), velocity, hiring. Rust deferred to V2 if a specific service hits a perf wall. |
| Backend framework | NestJS for `apps/api`; Fastify for workers | NestJS gives structure for the large surface area of `apps/api`; Fastify is lean for the workers. |
| Frontend | Next.js 15 App Router + Tailwind + shadcn/ui | Server components for the heavy admin pages, client components for the playbook editor. |
| Database | PostgreSQL 16 + pgvector | One database for relational, JSONB, and vectors. Move vectors to Pinecone/Weaviate only if pgvector chokes. |
| Cache / queue | Redis 7 + BullMQ | Redis for sessions, rate limits, pub/sub. BullMQ for durable jobs (inbound messages, outbound delivery, bootstrap). |
| ORM | Drizzle | Lightweight, generates types from schema, supports raw SQL escape hatch. No magic. |
| LLM (V1 default) | Anthropic Claude (Sonnet 4.5 class) | Tool-calling quality, low refusal rate on agentic tasks, streaming support. Abstraction in `packages/llm` keeps us swappable. |
| Voice telephony | Twilio Voice (V1.5: add Telnyx) | First-party support, lowest setup friction. |
| STT | Deepgram (streaming) | Sub-300ms end-of-utterance detection, the biggest single chunk of the voice latency budget. |
| TTS | ElevenLabs (V1); Cartesia (evaluate for V1.5) | ElevenLabs has more voice variety; Cartesia has lower first-byte latency. |
| WhatsApp | Meta Cloud API (direct) | Cheapest, no BSP markup. Gupshup as fallback for India-specific TPS issues. |
| Web chat embed | Custom JS SDK (in `packages/widget-sdk`) | Owned by us, lightweight, ~30 KB. |
| Vector store | pgvector (V1); evaluate Pinecone V1.5 | One database to manage at the start. |
| Object storage | AWS S3 | Voice recordings, uploaded KB files, audit log exports. |
| Search (BM25) | Postgres FTS with `pg_trgm` (V1); OpenSearch (V2) | Avoid an extra service in V1. |
| Auth (admin) | Clerk (V1) | Email/password + SSO for Enterprise tier without us building it. |
| Auth (internal services) | Signed JWT via `INTERNAL_SERVICE_SECRET` | Service-to-service identity. |
| Encryption | AES-256-GCM, envelope-encrypted via AWS KMS | Master key in KMS, per-record data keys. |
| Infra IaC | Terraform | All AWS infra defined in `infra/terraform`. |
| Container orchestration | AWS EKS (Kubernetes) | Multi-region requirement and data residency makes EKS worth the complexity. |
| Observability | OpenTelemetry → Datadog (V1); Grafana stack as fallback | Single vendor for traces/metrics/logs to start. |
| LLM observability | Langfuse (self-hosted, V1) | Trace every LLM call, cost attribution, eval playground. |
| Compliance tooling | Vanta | SOC2 evidence collection. Sign month 1. |
| CI/CD | GitHub Actions | Free for the team size, mature. |

## 1.5 Targets

- Time to live (new tenant onboarding completion): under 30 minutes for a technical admin.
- P95 text response latency (WhatsApp): under 3 seconds.
- P95 voice first-token latency (after end of utterance): under 800 ms.
- Bot resolution rate (V1 target): ≥ 60% for tenants with well-configured playbooks.
- SOC2 Type I: month 3. Type II: month 12.

---

# Part 2 — Repo Bootstrapping

## 2.1 The first PR

Before any feature work, this PR must merge. It scaffolds the monorepo, configures CI, and gets a green build on a "hello world" stub of every app. Once green, branching off this for feature work is safe.

### 2.1.1 Prerequisites

Local machine needs:
- Node.js 22 LTS (use `nvm`)
- pnpm 9+
- Docker Desktop (for local Postgres + Redis)
- PostgreSQL client (`psql`) for ad-hoc queries
- AWS CLI configured with a profile that can describe KMS keys (for local dev with a dev-only key)

### 2.1.2 Scaffold commands

Run from the empty repo root:

```bash
# pnpm workspace + turborepo
pnpm init
pnpm add -D -w turbo typescript @types/node tsx vitest @vitest/coverage-v8 \
  eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  eslint-plugin-import prettier husky lint-staged @changesets/cli

# Create workspace file
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

# Create turbo config
cat > turbo.json <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test":  { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint":  {},
    "typecheck": { "dependsOn": ["^build"] },
    "dev":   { "cache": false, "persistent": true }
  }
}
EOF

# Apps
mkdir -p apps/api apps/admin apps/channel-worker apps/voice-worker apps/eval-runner

# Packages
mkdir -p packages/types packages/db packages/llm packages/queue packages/logger \
         packages/errors packages/config packages/crypto packages/test-utils \
         packages/widget-sdk packages/eslint-config

# Infra
mkdir -p infra/terraform infra/docker infra/k8s

# Scripts
mkdir -p scripts
```

Then per-package `package.json`, `tsconfig.json`, and a "hello world" `src/index.ts` for each app. Use the same `tsconfig.base.json` at the repo root extended by each app.

### 2.1.3 Root `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

### 2.1.4 ESLint import boundary rules

Create `packages/eslint-config/index.js`:

```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // No app should import directly from another app
    'import/no-restricted-paths': ['error', {
      zones: [
        { target: './apps/admin', from: './apps/api/src' },
        { target: './apps/api', from: './apps/admin/src' },
        { target: './apps/channel-worker', from: './apps/voice-worker/src' },
        { target: './apps/voice-worker', from: './apps/channel-worker/src' },
        // packages/types depends on nothing
        { target: './packages/types', from: './apps' },
        { target: './packages/types', from: './packages',
          except: [] }, // types is the foundation
      ],
    }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
};
```

### 2.1.5 Docker Compose for local dev

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: platform_dev
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  # MailHog for local magic link delivery testing
  mailhog:
    image: mailhog/mailhog
    ports: ["1025:1025", "8025:8025"]

  # MinIO for S3-compatible local storage
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio12345

volumes:
  pgdata:
```

### 2.1.6 GitHub Actions CI

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: platform_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 10s
          --health-timeout 5s --health-retries 5

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }

      - run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm turbo typecheck

      - name: Lint
        run: pnpm turbo lint

      - name: Format check
        run: pnpm prettier --check .

      - name: Secret scan
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Unit tests + coverage
        run: pnpm turbo test -- --coverage
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/platform_test
          REDIS_URL: redis://localhost:6379

      - name: Coverage gate
        run: node scripts/check-coverage.mjs --min 80

      - name: Build
        run: pnpm turbo build

      - name: Dependency audit
        run: pnpm audit --audit-level=high
```

### 2.1.7 Pre-commit hooks

```bash
pnpm dlx husky init
echo "pnpm lint-staged" > .husky/pre-commit
```

`package.json` root additions:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["prettier --write", "eslint --fix"],
    "*.{md,yml,yaml,json}": ["prettier --write"]
  }
}
```

### 2.1.8 Definition of done for Part 2

- [ ] `pnpm install` from a fresh clone completes without errors.
- [ ] `pnpm turbo build` succeeds for all apps and packages with their hello-world stubs.
- [ ] `docker compose up -d` brings up Postgres, Redis, MailHog, and MinIO locally.
- [ ] CI passes on the bootstrap PR with all gates green.
- [ ] ESLint catches a deliberate import-boundary violation in a test (commit, see CI fail, remove).
- [ ] Gitleaks catches a deliberately committed dummy AWS key (commit, see CI fail, remove from history).
- [ ] README documents: clone steps, prerequisites, how to start local dev, how to run tests, how to add a new package.

Once this PR is merged, the rest of the manual unlocks.

---

# Part 3 — Layer 1: Foundations

> Repository structure · environments · shared types · cross-cutting concerns
> **Prerequisite for: every other layer.**

## 3.1 Goals

- Define the monorepo layout so every engineer knows where code lives and what the package boundaries are.
- Establish shared TypeScript types that are the single source of truth across all services.
- Define environment strategy (local / staging / prod / per-region) so no service hardcodes assumptions.
- Establish cross-cutting concerns (auth, logging, error handling, rate limiting, config) as shared libraries — built once, used everywhere.
- Define the CI pipeline gates that every PR must pass before merge.

## 3.2 Non-goals (Layer 1)

- No business logic lives here. This layer is pure infrastructure and shared contracts.
- No UI components. Those live in `apps/admin`.
- No LLM calls, no channel integrations, no database migrations for domain tables. Those are later layers.

## 3.3 Repository structure

Turborepo monorepo with pnpm workspaces. Single repo, multiple deployable services, shared packages.

```
/
├── apps/
│   ├── api/              # Core backend — NestJS. The main runtime server.
│   ├── admin/            # SaaS-facing dashboard — Next.js 15 App Router.
│   ├── channel-worker/   # Handles inbound/outbound channel messages — long-running Node process.
│   ├── voice-worker/     # Real-time voice session handler — low-latency Node process.
│   └── eval-runner/      # Offline eval harness — runs scenario + replay tests.
│
├── packages/
│   ├── types/            # Shared TypeScript interfaces and enums. No runtime code.
│   ├── db/               # Drizzle ORM schema + migrations + query helpers.
│   ├── llm/              # LLM abstraction layer — provider-agnostic client.
│   ├── queue/            # BullMQ queue definitions and job types.
│   ├── logger/           # Structured logger (Pino) with tenant/trace context.
│   ├── errors/           # Canonical error classes and error codes.
│   ├── config/           # Environment config loader and validator (Zod).
│   ├── crypto/           # Encryption helpers — keys at rest, token signing.
│   ├── widget-sdk/       # Embeddable web chat SDK (built and published separately).
│   └── test-utils/       # Shared test factories, mocks, DB test helpers.
│
├── infra/
│   ├── terraform/        # AWS infrastructure as code.
│   ├── docker/           # Dockerfiles per app.
│   └── k8s/              # Kubernetes manifests (staging + prod).
│
├── .github/
│   └── workflows/        # CI pipeline definitions.
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### Package boundary rules

Enforced via ESLint (see Part 2.1.4).

| Package | Can import from | Cannot import from |
|---|---|---|
| `packages/types` | Nothing | Everything |
| `packages/db` | `types`, `config`, `logger` | `apps/*`, `llm`, `queue` |
| `packages/llm` | `types`, `config`, `logger`, `errors` | `apps/*`, `db`, `queue` |
| `apps/api` | All `packages/*` | `apps/admin`, `apps/voice-worker` directly |
| `apps/admin` | `types`, `config` | `db`, `llm`, `queue` directly — only via API |

The rule: **apps never import from other apps**. All cross-app communication goes through the API or message queue. This keeps services independently deployable.

## 3.4 Shared types (`packages/types`)

These are the canonical types used across every service. No business logic — interfaces and enums only.

```typescript
// packages/types/src/tenant.ts

export enum TenantPlan {
  Lite = 'lite',
  Pro = 'pro',
  Max = 'max',
  Enterprise = 'enterprise',
}

export enum TenantStatus {
  Onboarding = 'onboarding',
  Active = 'active',
  Suspended = 'suspended',
  Churned = 'churned',
}

export interface Tenant {
  id: string;                        // UUID
  name: string;
  slug: string;                      // URL-safe unique identifier
  plan: TenantPlan;
  status: TenantStatus;
  region: DataRegion;                // Which region this tenant's data lives in
  llmConfig: LLMConfig;              // BYOK or platform-managed
  createdAt: Date;
  updatedAt: Date;
}

export enum DataRegion {
  UsEast = 'us-east-1',
  EuWest = 'eu-west-1',
  ApSouth = 'ap-south-1',
}
```

```typescript
// packages/types/src/channel.ts

export enum ChannelType {
  WhatsApp = 'whatsapp',
  Voice = 'voice',
  WebChat = 'web_chat',
  SMS = 'sms',
  Slack = 'slack',
  Teams = 'teams',
}

export enum ChannelStatus {
  PendingVerification = 'pending_verification',
  Active = 'active',
  Suspended = 'suspended',
  Disconnected = 'disconnected',
}

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  status: ChannelStatus;
  // Provider-specific config — typed discriminated union per channel type
  config: WhatsAppChannelConfig | VoiceChannelConfig | WebChatChannelConfig | SlackChannelConfig;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  businessHours?: BusinessHours;
  fallbackMessage: string;           // Sent when bot can't respond
  createdAt: Date;
}

export interface WhatsAppChannelConfig {
  type: 'whatsapp';
  phoneNumberId: string;             // Meta's phone number ID (BYO)
  wabaId: string;                    // WhatsApp Business Account ID
  accessToken: string;               // Encrypted at rest
  webhookVerifyToken: string;        // Meta webhook verification token
}

export interface VoiceChannelConfig {
  type: 'voice';
  phoneNumber: string;               // E.164 format
  provider: 'twilio' | 'telnyx';
  accountSid: string;                // Provider-side ID (encrypted at rest)
  authToken: string;                 // Encrypted at rest
  inboundEnabled: boolean;
  outboundEnabled: boolean;
}
```

```typescript
// packages/types/src/conversation.ts

export enum ConversationStatus {
  Active = 'active',
  WaitingForUser = 'waiting_for_user',
  WaitingForHuman = 'waiting_for_human',  // Escalated, not yet claimed
  HandedOff = 'handed_off',               // Claimed by an agent
  Resolved = 'resolved',
  Abandoned = 'abandoned',
}

export interface Conversation {
  id: string;
  tenantId: string;
  endUserId: string;
  status: ConversationStatus;
  activeChannelType: ChannelType;    // Which channel the latest message came from
  playbookId: string;
  playbookVersion: string;
  userStateAtStart: string;          // Snapshot of inferred state when conversation began
  currentUserState: string;          // Live — may change mid-conversation
  metadata: Record<string, unknown>;
  startedAt: Date;
  lastActivityAt: Date;
  resolvedAt?: Date;
}

export interface Turn {
  id: string;
  conversationId: string;
  tenantId: string;
  role: 'user' | 'assistant' | 'system';
  content: TurnContent;
  channelType: ChannelType;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  createdAt: Date;
}

export type TurnContent =
  | { type: 'text'; text: string }
  | { type: 'voice_note'; audioUrl: string; transcript: string; durationMs: number }
  | { type: 'tool_call'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: unknown; success: boolean }
  | { type: 'handoff'; reason: string; escalationTicketId: string };
```

```typescript
// packages/types/src/end-user.ts

export enum EndUserVerificationStatus {
  Unverified = 'unverified',
  MagicLinkSent = 'magic_link_sent',
  Verified = 'verified',
  StepUpRequired = 'step_up_required',
}

export interface EndUser {
  id: string;
  tenantId: string;
  externalUserId: string;            // The user's ID in the SaaS company's system
  phoneNumber?: string;              // E.164
  verificationStatus: EndUserVerificationStatus;
  verifiedAt?: Date;
  encryptedAccessToken?: string;     // Scoped SaaS API token, encrypted via packages/crypto
  tokenExpiresAt?: Date;
  currentUserState: string;
  stateInferredAt: Date;
  stateConfidence: number;           // 0-1
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

```typescript
// packages/types/src/llm.ts

export enum LLMProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  Google = 'google',
}

export type LLMConfig =
  | { mode: 'platform'; provider: LLMProvider; model: string }
  | { mode: 'byok'; provider: LLMProvider; model: string; encryptedApiKey: string };

export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMTool[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tenantId: string;
  conversationId: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: LLMProvider;
  latencyMs: number;
  cost?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | LLMToolResult[];
}

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  content: unknown;
}
```

## 3.5 Environment configuration (`packages/config`)

Every app loads config through this package. No `process.env` calls outside this package.

```typescript
// packages/config/src/schema.ts
import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  APP_NAME: z.string(),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  REDIS_URL: z.string().url(),

  MASTER_ENCRYPTION_KEY: z.string().min(64),
  INTERNAL_SERVICE_SECRET: z.string().min(32),

  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof baseSchema>;

export function loadConfig(): Config {
  const result = baseSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}
```

### Environment strategy

| Environment | Purpose | Data | Notes |
|---|---|---|---|
| `development` | Local dev, feature work | Synthetic only | Docker Compose for Postgres + Redis |
| `test` | CI unit + integration tests | In-memory / test DB | Spun up per PR, torn down after |
| `staging` | Pre-prod QA, design partner demos | Anonymized prod-like | Mirrors prod topology, single region |
| `production` | Live tenant traffic | Real | Multi-region, HA, SOC2-compliant |

## 3.6 Structured logging (`packages/logger`)

Every log line carries tenant, trace, and conversation context. Non-negotiable for debugging multi-tenant issues in production.

```typescript
// packages/logger/src/index.ts
import pino from 'pino';

export interface LogContext {
  tenantId?: string;
  conversationId?: string;
  endUserId?: string;
  traceId?: string;
  spanId?: string;
  channelType?: string;
  playbookId?: string;
}

export function createLogger(context: LogContext) {
  return pino({ level: process.env.LOG_LEVEL ?? 'info' }).child(context);
}

// Usage pattern:
// const log = createLogger({ tenantId, conversationId, traceId });
// log.info({ latencyMs }, 'LLM call completed');
// log.error({ err, actionName }, 'Action invocation failed');
```

## 3.7 Canonical error classes (`packages/errors`)

```typescript
export enum ErrorCode {
  // Auth
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  MagicLinkExpired = 'MAGIC_LINK_EXPIRED',
  StepUpRequired = 'STEP_UP_REQUIRED',

  // Tenant / config
  TenantNotFound = 'TENANT_NOT_FOUND',
  TenantSuspended = 'TENANT_SUSPENDED',
  PlaybookNotFound = 'PLAYBOOK_NOT_FOUND',

  // Integration
  SaaSAPIError = 'SAAS_API_ERROR',
  SaaSAPITimeout = 'SAAS_API_TIMEOUT',
  ActionNotPermitted = 'ACTION_NOT_PERMITTED',
  ActionTierViolation = 'ACTION_TIER_VIOLATION',
  RateLimitExceeded = 'RATE_LIMIT_EXCEEDED',

  // LLM
  LLMProviderError = 'LLM_PROVIDER_ERROR',
  LLMKeyInvalid = 'LLM_KEY_INVALID',

  // Channel
  ChannelNotActive = 'CHANNEL_NOT_ACTIVE',
  ChannelVerificationFailed = 'CHANNEL_VERIFICATION_FAILED',

  // General
  InternalError = 'INTERNAL_ERROR',
  NotFound = 'NOT_FOUND',
  ValidationError = 'VALIDATION_ERROR',
  ConflictError = 'CONFLICT_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  unauthorized: (msg = 'Unauthorized') =>
    new AppError(ErrorCode.Unauthorized, msg, 401),
  forbidden: (msg = 'Forbidden') =>
    new AppError(ErrorCode.Forbidden, msg, 403),
  notFound: (entity: string, id: string) =>
    new AppError(ErrorCode.NotFound, `${entity} not found: ${id}`, 404),
  validation: (details: Record<string, unknown>) =>
    new AppError(ErrorCode.ValidationError, 'Validation failed', 422, details),
  actionTierViolation: (action: string, tier: number) =>
    new AppError(ErrorCode.ActionTierViolation,
      `Action '${action}' requires tier ${tier} confirmation`, 403, { action, tier }),
  rateLimited: (retryAfterMs: number) =>
    new AppError(ErrorCode.RateLimitExceeded, 'Rate limit exceeded', 429, { retryAfterMs }),
};
```

## 3.8 Encryption (`packages/crypto`)

Tenant secrets are never stored in plaintext. This package is the only place encryption and decryption logic lives.

```typescript
export interface EncryptedValue {
  ciphertext: string;   // base64
  iv: string;           // base64, randomized per encrypt call
  tag: string;          // base64 — GCM authentication tag
  keyVersion: string;   // Supports key rotation without re-encrypting everything at once
}

export async function encrypt(plaintext: string): Promise<EncryptedValue> { /* ... */ }
export async function decrypt(encrypted: EncryptedValue): Promise<string> { /* ... */ }

export function signToken(payload: TokenPayload, expiresInSeconds: number): string { /* ... */ }
export function verifyToken(token: string): TokenPayload { /* ... */ }

export interface TokenPayload {
  tenantId: string;
  endUserId: string;
  purpose: 'magic_link' | 'step_up' | 'web_session';
  issuedAt: number;
  expiresAt: number;
}
```

**Key management rules:**
- Master key lives in AWS KMS in staging/prod. Envelope encryption: KMS encrypts a per-record data key, the data key encrypts the secret.
- Key rotation supported via `keyVersion` — old records re-encrypted on next write after rotation.
- No master key in environment variables in staging or production. Development only.

## 3.9 Database schema — foundation tables (`packages/db`)

Drizzle ORM. Postgres. These are the base tables only.

```typescript
// packages/db/src/schema/tenants.ts
import { pgTable, uuid, varchar, text, timestamp, jsonb, pgEnum, boolean } from 'drizzle-orm/pg-core';

export const tenantPlanEnum = pgEnum('tenant_plan', ['lite', 'pro', 'max', 'enterprise']);
export const tenantStatusEnum = pgEnum('tenant_status', ['onboarding', 'active', 'suspended', 'churned']);
export const dataRegionEnum = pgEnum('data_region', ['us-east-1', 'eu-west-1', 'ap-south-1']);

export const tenants = pgTable('tenants', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      varchar('name', { length: 255 }).notNull(),
  slug:      varchar('slug', { length: 100 }).notNull().unique(),
  plan:      tenantPlanEnum('plan').notNull().default('lite'),
  status:    tenantStatusEnum('status').notNull().default('onboarding'),
  region:    dataRegionEnum('region').notNull(),
  llmConfig: jsonb('llm_config').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const adminUsers = pgTable('admin_users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  email:        varchar('email', { length: 255 }).notNull().unique(),
  name:         varchar('name', { length: 255 }).notNull(),
  role:         varchar('role', { length: 50 }).notNull().default('member'),
  passwordHash: text('password_hash').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});
```

```typescript
// packages/db/src/schema/channels.ts
export const channelStatusEnum = pgEnum('channel_status',
  ['pending_verification', 'active', 'suspended', 'disconnected']);

export const channels = pgTable('channels', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  type:            varchar('type', { length: 50 }).notNull(),
  status:          channelStatusEnum('status').notNull().default('pending_verification'),
  config:          jsonb('config').notNull(),
  inboundEnabled:  boolean('inbound_enabled').notNull().default(true),
  outboundEnabled: boolean('outbound_enabled').notNull().default(false),
  businessHours:   jsonb('business_hours'),
  fallbackMessage: text('fallback_message').notNull(),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
  updatedAt:       timestamp('updated_at').notNull().defaultNow(),
});
```

```typescript
// packages/db/src/schema/audit.ts
// Immutable by design. No UPDATE or DELETE ever runs on this table.
// Row-level security policy in Postgres enforces this at the DB layer too.

export const auditEvents = pgTable('audit_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenantId:       uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id'),
  endUserId:      uuid('end_user_id'),
  adminUserId:    uuid('admin_user_id'),
  eventType:      varchar('event_type', { length: 100 }).notNull(),
  payload:        jsonb('payload').notNull(),
  traceId:        varchar('trace_id', { length: 64 }),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});
// Required indexes: (tenant_id, created_at), conversation_id, event_type
```

**SQL DDL for immutability** (apply as a migration after creating `audit_events`):

```sql
CREATE OR REPLACE FUNCTION reject_audit_modifications()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_modifications();
```

## 3.10 CI pipeline gates (recap of Part 2.1.6)

Every PR must pass all gates before merge:

```
PR opened or pushed
        |
        v
  Type check (tsc)              -- packages/types + all apps
  Lint (ESLint)                 -- import boundary rules enforced here
  Format check (Prettier)
        |
        v
  Unit tests (Vitest)           -- packages/* only, no I/O, fast
  Coverage gate: >= 80%
        |
        v
  Integration tests             -- apps/api against Docker Postgres + Redis
        |
        v
  Security scan                 -- pnpm audit (dependency CVEs)
  Secret scan                   -- Gitleaks (no secrets committed)
        |
        v
  Build all apps                -- confirms no build-time errors in any app
        |
        v
  Merge allowed
```

## 3.11 Acceptance criteria

**Given** the monorepo is cloned on a fresh machine
**When** `pnpm install && pnpm build` is run
**Then** all apps build without errors and all shared packages compile cleanly.

**Given** an app imports directly from another app
**When** the lint step runs in CI
**Then** the build fails with a readable import boundary violation error.

**Given** `loadConfig()` is called with a missing required environment variable
**When** any app starts
**Then** the process exits immediately with a human-readable error listing every missing field.

**Given** a plaintext secret is passed to `encrypt()`
**When** the result is stored and later passed to `decrypt()`
**Then** the original plaintext is recovered exactly, and the stored ciphertext is not readable as the original in the database.

**Given** `encrypt()` is called twice with the same plaintext
**When** the two ciphertexts are compared
**Then** they are different — IV randomization means no deterministic leakage.

**Given** an `AppError` is thrown anywhere in `apps/api`
**When** it reaches the global exception filter
**Then** the HTTP response carries the correct status code, the `code` field, and no internal stack trace in the body.

**Given** a PR contains a string matching a known secret pattern
**When** Gitleaks runs
**Then** the CI pipeline fails and the PR is blocked.

**Given** an attempt to UPDATE or DELETE a row in `audit_events`
**When** the SQL executes
**Then** the database raises an exception and the operation fails.

## 3.12 Test cases

### Unit tests

| Test | Target | What it verifies |
|---|---|---|
| Encrypt then decrypt roundtrip | `packages/crypto` | Plaintext survives unchanged |
| Two encryptions of same input produce different ciphertexts | `packages/crypto` | IV is randomized |
| `verifyToken` rejects an expired token | `packages/crypto` | Expiry enforced |
| `verifyToken` rejects a tampered token | `packages/crypto` | HMAC signature check |
| `loadConfig` exits with code 1 on missing required field | `packages/config` | Zod validation + fast fail |
| `loadConfig` returns fully typed object on valid env | `packages/config` | Happy path |
| `Errors.actionTierViolation` carries correct code and statusCode | `packages/errors` | Error shape contract |
| `Errors.rateLimited` carries retryAfterMs in details | `packages/errors` | Details field populated |
| `createLogger` child carries all context fields on every log line | `packages/logger` | Structured context |

### Integration tests

| Test | What it verifies |
|---|---|
| Health endpoint returns 200 with expected shape | App boots and DB connects |
| Migration applied — all base tables exist | Schema migrations run on startup |
| Write to `audit_events` succeeds; UPDATE on same row fails | Immutability enforced at DB layer |

### Security tests

| Test | What it verifies |
|---|---|
| No plaintext secrets in committed files | Gitleaks scan passes on entire git history |
| All dependencies have no high or critical CVEs | pnpm audit gate passes |
| Import boundary violations are caught by linter | ESLint import plugin correctly configured |

## 3.13 Definition of done for Layer 1

- [ ] Monorepo scaffolded: all `apps/` and `packages/` directories with correct `package.json` and `tsconfig.json`.
- [ ] `packages/types` exports all interfaces, compiles with zero TS errors.
- [ ] `packages/config` loads and validates env, crashes fast on missing fields.
- [ ] `packages/logger` emits structured logs with context.
- [ ] `packages/errors` exports `AppError`, `ErrorCode`, all `Errors` constructors.
- [ ] `packages/crypto` passes all unit tests.
- [ ] `packages/db` connects to Postgres, migrations run, base tables created.
- [ ] Row-level immutability triggers on `audit_events` prevent UPDATE/DELETE.
- [ ] ESLint boundary rules enforced — one deliberate violation caught and removed.
- [ ] CI pipeline covers all gates in 3.10.
- [ ] All acceptance criteria pass.
- [ ] All unit + integration tests pass with ≥80% coverage on `packages/*`.
- [ ] `docker-compose.yml` spins up local dev with one command.
- [ ] README documents: setup, env vars, tests, adding a new package.

---

# Part 4 — Layer 2: Channel Layer

> WhatsApp · Voice · Web Chat · SMS · Slack · Teams
> Depends on: Layer 1 (Foundations)
> Consumed by: Layer 3 (Identity & Session)

## 4.1 Goals

- Receive inbound messages from every connected channel and normalize them into a single internal `InboundMessage` format before anything else touches them.
- Send outbound messages from the platform back to end users on any channel, accepting a single `OutboundMessage` format and handling channel-specific delivery mechanics.
- Manage tenant-owned channel credentials — connect, verify, refresh, revoke — without ever exposing those credentials outside this layer.
- Enforce channel-level rules: business hours, inbound/outbound toggles, rate limits, fallback messages.
- Be stateless with respect to conversation logic. This layer routes messages in and out. It does not decide what to say.

## 4.2 Non-goals (Layer 2)

- No LLM calls. No playbook evaluation. No action execution.
- No conversation state. The channel layer does not know or care what was said before.
- No end-user identity resolution. That is Layer 3.
- No media transcription. Voice notes arrive here as audio URLs; transcription happens in Layer 3.

## 4.3 Architecture

The channel layer lives in `apps/channel-worker` (long-running Node process for webhook handling and outbound delivery) and a slice of `apps/api` (REST endpoints for channel management — connect, configure, verify).

Voice is handled separately in `apps/voice-worker` due to the latency requirements of real-time telephony. The voice worker shares the same channel types and normalized message formats.

```
External channel                  Platform
─────────────────                 ─────────────────────────────────────
WhatsApp Cloud API  ──webhook──►  /webhooks/whatsapp/:tenantSlug
Twilio Voice        ──webhook──►  /webhooks/voice/:tenantSlug
Web Chat (JS SDK)   ──WebSocket►  /ws/chat/:tenantSlug
Slack Events API    ──webhook──►  /webhooks/slack/:tenantSlug
Teams Bot Framework ──webhook──►  /webhooks/teams/:tenantSlug
SMS (Twilio)        ──webhook──►  /webhooks/sms/:tenantSlug
                                          │
                                  Normalize to InboundMessage
                                          │
                                  Verify channel is active
                                  Check business hours
                                  Check inbound rate limit
                                          │
                                  Enqueue to conversation queue
                                  (BullMQ job → Layer 3 picks up)
                                          │
                              ◄── Ack 200 to provider immediately
```

The webhook handler's only job is: validate the request, normalize the payload, enqueue the job, and return 200 in under 200ms. Provider retries (WhatsApp retries for 24 hours if it doesn't get a 200) are avoided by keeping this path as thin as possible.

## 4.4 Normalized message format

Everything that enters the platform from any channel becomes one of these. Everything that leaves becomes a channel-specific delivery from one of these.

```typescript
// packages/types/src/messages.ts

export interface InboundMessage {
  id: string;                        // Our ID — deduplicated on this
  externalId: string;                // Provider's message ID (for dedup + receipt tracking)
  tenantId: string;
  channelType: ChannelType;
  channelId: string;                 // Which of the tenant's channels this came in on
  from: ChannelEndpoint;             // Who sent it
  receivedAt: Date;
  content: InboundContent;
  raw: Record<string, unknown>;      // Original provider payload — stored for debugging
}

export type InboundContent =
  | { type: 'text'; text: string }
  | { type: 'voice_note'; audioUrl: string; mimeType: string; durationMs: number }
  | { type: 'voice_call'; callSid: string; from: string; to: string }
  | { type: 'image'; imageUrl: string; caption?: string }
  | { type: 'document'; documentUrl: string; filename: string; mimeType: string }
  | { type: 'interactive_reply'; buttonId: string; buttonText: string }
  | { type: 'dtmf'; digits: string }
  | { type: 'unsupported'; rawType: string };

export interface ChannelEndpoint {
  identifier: string;
  displayName?: string;
}

export interface OutboundMessage {
  tenantId: string;
  channelType: ChannelType;
  channelId: string;
  to: ChannelEndpoint;
  content: OutboundContent;
  conversationId: string;
  metadata?: Record<string, unknown>;
}

export type OutboundContent =
  | { type: 'text'; text: string }
  | { type: 'text_with_buttons'; text: string; buttons: QuickReplyButton[] }
  | { type: 'voice_speak'; ssml: string }
  | { type: 'voice_gather'; ssml: string; inputType: 'dtmf' | 'speech' | 'both' }
  | { type: 'voice_hangup'; ssml?: string }
  | { type: 'image'; imageUrl: string; caption?: string }
  | { type: 'magic_link'; text: string; url: string };

export interface QuickReplyButton {
  id: string;
  text: string;           // Max 20 chars for WhatsApp
}
```

## 4.5 Channel worker — inbound webhook handlers

### 4.5.1 WhatsApp (Meta Cloud API)

```typescript
// apps/channel-worker/src/handlers/whatsapp.ts

export async function handleWhatsAppWebhook(req: Request, tenantSlug: string) {
  // Step 1: Verify the request is genuinely from Meta.
  verifyMetaSignature(req.headers['x-hub-signature-256'], req.rawBody, appSecret);

  const body = req.body as WhatsAppWebhookPayload;

  // Step 2: Handle the verification handshake (GET request — Meta does this on setup)
  if (req.method === 'GET') {
    return handleVerificationChallenge(req.query, channel.config.webhookVerifyToken);
  }

  // Step 3: Parse and normalize each message.
  for (const entry of body.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        // Deduplication — Meta may deliver the same message more than once
        const alreadyProcessed = await checkAndMarkProcessed(message.id);
        if (alreadyProcessed) continue;

        const inbound = normalizeWhatsAppMessage(message, tenantId, channelId);

        // Enforce business hours and inbound toggle
        const channel = await getActiveChannel(tenantId, ChannelType.WhatsApp);
        if (!channel.inboundEnabled) {
          await sendFallback(channel, inbound.from);
          continue;
        }
        if (!isWithinBusinessHours(channel.businessHours)) {
          await sendOutOfHoursMessage(channel, inbound.from);
          continue;
        }

        await inboundQueue.add('inbound_message', inbound, { priority: 1 });
      }

      // Handle read receipts and status updates
      for (const status of change.value.statuses ?? []) {
        await handleWhatsAppStatusUpdate(status, tenantId);
      }
    }
  }

  return { status: 200 };
}
```

**WhatsApp-specific rules:**
- 24-hour messaging window: outside this window, only approved template messages can be sent. The outbound sender must check window status before sending free-form and fall back to a template.
- Template messages must be pre-approved by Meta. Each tenant needs at least one approved template for: greeting, re-engagement (out of window), OTP/magic link delivery.
- Media arrives as a media ID. The handler calls the Meta API to download the actual file before enqueuing.

### 4.5.2 Voice (Twilio + Deepgram)

Voice is fundamentally different from messaging — it is real-time, stateful, bidirectional.

```typescript
// apps/voice-worker/src/handlers/voice-inbound.ts

// Twilio calls this URL when an inbound call arrives.
// We must respond with TwiML within 5 seconds or the call drops.

export async function handleInboundCall(req: TwilioWebhookRequest): Promise<TwiMLResponse> {
  const { CallSid, From, To } = req.body;

  const tenant = await getTenantByVoiceNumber(To);
  if (!tenant) return twiml.hangup('This number is not currently in service.');

  const channel = await getActiveVoiceChannel(tenant.id);
  if (!channel.inboundEnabled) return twiml.hangup(channel.fallbackMessage);
  if (!isWithinBusinessHours(channel.businessHours)) {
    return twiml.say(outOfHoursMessage).hangup();
  }

  // Create a voice session — this tracks the full call lifecycle
  const session = await createVoiceSession({ callSid: CallSid, tenantId: tenant.id, from: From });

  // Connect the call to our media stream for real-time STT
  return twiml.connect().stream({
    url: `wss://${config.VOICE_WORKER_HOST}/voice/stream/${session.id}`,
    track: 'inbound_track',
  });
}

// WebSocket handler — Twilio streams audio here in real time
export async function handleVoiceStream(ws: WebSocket, sessionId: string) {
  const session = await getVoiceSession(sessionId);
  const deepgramClient = createDeepgramConnection();

  ws.on('message', async (data) => {
    const event = JSON.parse(data.toString());
    if (event.event === 'media') {
      deepgramClient.send(Buffer.from(event.media.payload, 'base64'));
    }
    if (event.event === 'stop') {
      await finalizeVoiceSession(session);
      deepgramClient.finish();
    }
  });

  // Receive transcripts from Deepgram → enqueue as inbound messages
  deepgramClient.on('transcript', async (transcript) => {
    if (!transcript.is_final) return;

    const inbound: InboundMessage = {
      id: ulid(),
      externalId: `${session.callSid}-${transcript.start}`,
      tenantId: session.tenantId,
      channelType: ChannelType.Voice,
      channelId: session.channelId,
      from: { identifier: session.from },
      receivedAt: new Date(),
      content: { type: 'text', text: transcript.transcript },
      raw: { transcript },
    };

    await inboundQueue.add('inbound_message', inbound, { priority: 0 });
  });
}
```

**Voice latency budget:**
The target is for the bot to begin speaking within 800ms of the user finishing their utterance:

```
User stops speaking
  │
  ├── Deepgram end-of-utterance detection:     ~200ms
  ├── Inbound message enqueue + dequeue:        ~20ms
  ├── Conversation engine + LLM first token:   ~300ms
  ├── TTS first audio chunk (streaming):       ~150ms
  ├── Network to Twilio + to user:             ~100ms
  │                                          ─────────
  └── Total target:                            ~770ms
```

Every service in this path must stream. LLM response streams token-by-token → TTS synthesizes in chunks → audio chunks sent to Twilio. Never wait for complete LLM response before starting TTS.

**Voice OTP flow:**

```typescript
async function handleVoiceOTP(session: VoiceSession): Promise<TwiMLResponse> {
  // Option A: SMS OTP to the calling number (preferred)
  const otp = generateOTP(6);
  await storePendingOTP(session.id, otp, expiresInSeconds(300));
  await sendSMS(session.from, `Your verification code is ${otp}. Valid for 5 minutes.`);

  return twiml
    .say("I've sent a 6-digit code to your phone number. Please enter it using your keypad.")
    .gather({ input: 'dtmf', numDigits: 6, action: `/voice/verify-otp/${session.id}` });
}

// Option B: Spoken OTP entry (fallback for landlines and non-SMS numbers)
async function handleVoiceOTPSpoken(session: VoiceSession): Promise<TwiMLResponse> {
  return twiml
    .say("Please say your 6-digit verification code now.")
    .gather({ input: 'speech', speechTimeout: 'auto', action: `/voice/verify-otp-speech/${session.id}` });
}
```

### 4.5.3 Web chat (WebSocket)

```typescript
// apps/channel-worker/src/handlers/web-chat.ts

// Tenants embed our JS widget. The widget opens a WebSocket to this endpoint.
// Connection is authenticated with a short-lived widget token
// (issued by our API when the SaaS app loads — signed with tenantId + sessionId).

export async function handleWebChatConnection(ws: WebSocket, req: Request) {
  const { tenantId, widgetSessionId } = verifyWidgetToken(req.query.token);
  const channel = await getActiveChannel(tenantId, ChannelType.WebChat);

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString()) as WebChatClientMessage;

    const inbound: InboundMessage = {
      id: ulid(),
      externalId: `${widgetSessionId}-${msg.clientMessageId}`,
      tenantId,
      channelType: ChannelType.WebChat,
      channelId: channel.id,
      from: { identifier: widgetSessionId },
      receivedAt: new Date(),
      content: { type: 'text', text: msg.text },
      raw: { msg },
    };

    await inboundQueue.add('inbound_message', inbound);
    ws.send(JSON.stringify({ type: 'ack', messageId: msg.clientMessageId }));
  });

  // Outbound: the conversation engine writes to a Redis pub/sub channel
  // The WebSocket handler subscribes and forwards to the browser
  const sub = createRedisSub();
  sub.subscribe(`outbound:${widgetSessionId}`, (outbound: OutboundMessage) => {
    ws.send(JSON.stringify({ type: 'message', content: outbound.content }));
  });

  ws.on('close', () => sub.unsubscribe(`outbound:${widgetSessionId}`));
}
```

### 4.5.4 Slack and Teams

Both follow the same pattern: install the bot app, receive events via webhook, normalize to `InboundMessage`, route back via the provider's API.

- **Slack** — Slack Bolt SDK. Setup includes a one-time challenge response. User identifier: Slack user ID (e.g. `U0123ABCDE`). The Slack-user → SaaS-user mapping is resolved in Layer 3.
- **Teams** — Bot Framework SDK. OAuth2 with AAD tokens. User identifier: AAD object ID. Rich card payloads normalized to text in V1; rich cards are V1.5.

## 4.6 Outbound delivery

```typescript
// apps/channel-worker/src/senders/index.ts

export async function deliverOutboundMessage(msg: OutboundMessage): Promise<DeliveryResult> {
  const channel = await getChannel(msg.channelId);

  if (!channel.outboundEnabled) {
    throw Errors.forbidden(`Outbound is disabled on channel ${msg.channelId}`);
  }

  switch (msg.channelType) {
    case ChannelType.WhatsApp: return deliverWhatsApp(msg, channel);
    case ChannelType.Voice:    return deliverVoice(msg, channel);
    case ChannelType.WebChat:  return deliverWebChat(msg);
    case ChannelType.SMS:      return deliverSMS(msg, channel);
    case ChannelType.Slack:    return deliverSlack(msg, channel);
    case ChannelType.Teams:    return deliverTeams(msg, channel);
  }
}

async function deliverWhatsApp(msg: OutboundMessage, channel: Channel): Promise<DeliveryResult> {
  const config = channel.config as WhatsAppChannelConfig;
  const client = new MetaCloudAPIClient(await decrypt(config.accessToken));

  const withinWindow = await isWhatsAppWindowOpen(msg.to.identifier, msg.tenantId);

  if (msg.content.type === 'text' && withinWindow) {
    return client.sendTextMessage(config.phoneNumberId, msg.to.identifier, msg.content.text);
  }

  if (!withinWindow) {
    // Must use a pre-approved template outside the window
    const template = await getReEngagementTemplate(msg.tenantId);
    return client.sendTemplateMessage(config.phoneNumberId, msg.to.identifier, template);
  }

  if (msg.content.type === 'text_with_buttons') {
    return client.sendInteractiveMessage(config.phoneNumberId, msg.to.identifier, {
      body: msg.content.text,
      buttons: msg.content.buttons,
    });
  }

  if (msg.content.type === 'magic_link') {
    return client.sendTextMessage(
      config.phoneNumberId,
      msg.to.identifier,
      `${msg.content.text}\n\n${msg.content.url}`
    );
  }
}
```

## 4.7 Channel management API (admin-facing)

```
POST   /api/v1/channels                    Create a new channel (starts in pending_verification)
GET    /api/v1/channels                    List all channels for the tenant
GET    /api/v1/channels/:id                Get a single channel with config (secrets masked)
PATCH  /api/v1/channels/:id               Update config, business hours, fallback message
DELETE /api/v1/channels/:id               Disconnect a channel (sets status to disconnected)
POST   /api/v1/channels/:id/verify        Trigger verification (e.g. send Meta handshake)
POST   /api/v1/channels/:id/test          Send a test message to a specified recipient
GET    /api/v1/channels/:id/status        Get live connection status from provider
POST   /api/v1/channels/whatsapp/oauth    WhatsApp Business OAuth callback handler
POST   /api/v1/channels/slack/oauth       Slack workspace install OAuth callback
POST   /api/v1/channels/teams/oauth       Teams bot install callback
```

**Secret masking rule:** API responses for channel config always mask credential fields. Last 4 characters are shown (`••••••••ABCD`) so the admin can confirm which credential is stored without exposing it.

## 4.8 Rate limiting

```typescript
export interface ChannelRateLimitConfig {
  maxInboundPerUserPerMinute: number;   // Default: 10
  maxOutboundPerUserPerHour: number;    // Default: 60
  maxConcurrentVoiceSessions: number;   // Default: 5 per tenant
}

// Implementation: Redis sliding window counter
// Key: `ratelimit:inbound:{tenantId}:{channelType}:{userIdentifier}`
// On limit breach: send fallback message, drop the inbound job
```

## 4.9 Database schema — channel layer tables

```typescript
// packages/db/src/schema/messages.ts

// Inbound messages — stored after normalization, before processing
export const inboundMessages = pgTable('inbound_messages', {
  id:             uuid('id').primaryKey(),
  externalId:     varchar('external_id', { length: 255 }).notNull(),
  tenantId:       uuid('tenant_id').notNull().references(() => tenants.id),
  channelId:      uuid('channel_id').notNull().references(() => channels.id),
  channelType:    varchar('channel_type', { length: 50 }).notNull(),
  fromIdentifier: varchar('from_identifier', { length: 255 }).notNull(),
  contentType:    varchar('content_type', { length: 50 }).notNull(),
  content:        jsonb('content').notNull(),
  raw:            jsonb('raw').notNull(),
  receivedAt:     timestamp('received_at').notNull(),
  processedAt:    timestamp('processed_at'),
  processingError: text('processing_error'),
});
// Unique index on (tenantId, externalId) — deduplication key
// Index on (tenantId, receivedAt) — range queries for replay

// Voice sessions — one per phone call
export const voiceSessions = pgTable('voice_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
  channelId:    uuid('channel_id').notNull().references(() => channels.id),
  callSid:      varchar('call_sid', { length: 100 }).notNull().unique(),
  from:         varchar('from', { length: 50 }).notNull(),
  to:           varchar('to', { length: 50 }).notNull(),
  direction:    varchar('direction', { length: 20 }).notNull(),
  status:       varchar('status', { length: 50 }).notNull(),
  conversationId: uuid('conversation_id'),
  startedAt:    timestamp('started_at').notNull(),
  answeredAt:   timestamp('answered_at'),
  endedAt:      timestamp('ended_at'),
  durationMs:   integer('duration_ms'),
  recordingUrl: text('recording_url'),
});
```

## 4.10 Acceptance criteria

**Given** a WhatsApp message arrives at the webhook
**When** the `X-Hub-Signature-256` header does not match the computed HMAC
**Then** the request is rejected with 403 and no message is enqueued.

**Given** a valid WhatsApp message arrives
**When** the tenant's inbound toggle is disabled
**Then** the platform sends the channel's fallback message and does not enqueue.

**Given** a valid WhatsApp message arrives
**When** the current time is outside the tenant's configured business hours
**Then** the platform sends the out-of-hours message and does not enqueue.

**Given** the same WhatsApp message is delivered twice by Meta
**When** the second copy arrives
**Then** it is silently dropped — no duplicate job is enqueued.

**Given** a voice call arrives on an inbound-enabled tenant voice channel
**When** the call connects
**Then** the TwiML response to connect the media stream is returned within 2 seconds.

**Given** an outbound text message is sent to a WhatsApp user
**When** the user's 24-hour messaging window is closed
**Then** the platform automatically sends the tenant's re-engagement template, and logs the substitution to the audit trail.

**Given** an end user sends more than 10 WhatsApp messages within 60 seconds
**When** the 11th message arrives
**Then** it is rate-limited — the user receives a "please slow down" message and the message is not enqueued.

**Given** a channel secret is stored
**When** the channel is retrieved via the admin API
**Then** the access token field is masked — only the last 4 characters are visible.

**Given** a tenant creates a WhatsApp channel
**When** creation succeeds
**Then** the response includes the webhook URL the tenant must configure in Meta's dashboard, and the channel status is `pending_verification`.

## 4.11 Test cases

### Unit tests

| Test | What it verifies |
|---|---|
| `normalizeWhatsAppMessage` maps every type to the correct `InboundContent` variant | Normalization correctness |
| `normalizeWhatsAppMessage` with an unknown type returns `unsupported` content | Graceful unknown handling |
| `isWhatsAppWindowOpen` returns false when last inbound is > 24 hours ago | Window logic |
| `verifyMetaSignature` returns false on tampered body | Signature verification |
| OTP generation produces 6-digit numeric string | OTP format |
| `isWithinBusinessHours` returns correct result for UTC timezone | Business hours logic |
| Rate limit counter increments and blocks on threshold | Rate limit enforcement |

### Integration tests

| Test | What it verifies |
|---|---|
| POST to `/webhooks/whatsapp/:slug` with valid signed payload enqueues exactly one job | Happy path inbound |
| POST with duplicate message ID enqueues zero jobs | Dedup works |
| POST with invalid signature returns 403 | Security |
| POST always returns 200 within 500ms even if queue is slow | Provider ack SLA |
| POST `/api/v1/channels` stores access token encrypted | Credential encryption |
| GET `/api/v1/channels/:id` returns masked access token | Secret masking |
| Channel with `inboundEnabled: false` — inbound webhook triggers fallback, no queue job | Toggle enforcement |

### E2E tests (staging environment with test WhatsApp BSP account)

| Test | What it verifies |
|---|---|
| Send a WhatsApp message → platform receives, normalizes, enqueues | Full inbound path |
| Platform sends outbound → WhatsApp delivers to test number | Full outbound path |
| Send message outside business hours → out-of-hours message received | Business hours E2E |

### Load tests

| Test | Target | Threshold |
|---|---|---|
| WhatsApp webhook handler under burst load | 500 concurrent messages | P99 response time < 200ms |
| Outbound delivery throughput | 1,000 outbound messages/min | Zero failures, no drops |

### Security tests

| Test | What it verifies |
|---|---|
| Webhook endpoint with no signature header returns 403 | Signature required |
| Webhook with correct format but wrong secret returns 403 | Wrong-secret rejection |
| Outbound API call with another tenant's channelId returns 403 | Tenant isolation |
| Channel config API never returns credential in plaintext | Secret masking |

## 4.12 Rollout plan

**Feature flags:**
- `channel.whatsapp.enabled` — per tenant. Off by default until onboarding completes.
- `channel.voice.inbound.enabled` — per tenant. Gated separately from outbound.
- `channel.voice.outbound.enabled` — per tenant. Requires explicit opt-in.
- `channel.slack.enabled`, `channel.teams.enabled` — per tenant, off by default in V1.

**Rollout order within Layer 2:**
1. Web chat — lowest complexity, no external provider dependencies.
2. WhatsApp — test with internal test WABA numbers. One design partner pilot.
3. SMS — Twilio integration reused from Voice.
4. Voice (inbound) — requires voice worker deployment and Deepgram integration.
5. Voice (outbound) — enabled per-tenant only after inbound is stable for 2+ weeks.
6. Slack and Teams — V1 but lowest priority.

## 4.13 Definition of done for Layer 2

- [ ] WhatsApp inbound: signature verification, dedup, normalization, enqueue. Returns 200 within 200ms.
- [ ] WhatsApp outbound: text, buttons, magic link, template (out-of-window) delivery all working.
- [ ] Voice inbound: Twilio webhook → TwiML → media stream → Deepgram → transcript → inbound message enqueued.
- [ ] Voice OTP: SMS OTP (primary) and DTMF spoken OTP (secondary) both implemented and tested.
- [ ] Voice latency measured E2E in staging — first bot audio within 800ms of user utterance end.
- [ ] Web chat WebSocket server: connect, receive, ack, deliver outbound via Redis pub/sub.
- [ ] SMS inbound and outbound via Twilio.
- [ ] Slack bot: install OAuth, receive messages, send replies.
- [ ] Teams bot: install callback, receive messages, send replies.
- [ ] Business hours enforcement on all channel types.
- [ ] Inbound/outbound toggle enforcement on all channel types.
- [ ] Rate limiting: inbound per user per minute, outbound per user per hour.
- [ ] Channel management API: all endpoints implemented with secret masking.
- [ ] All acceptance criteria in 4.10 pass.
- [ ] All unit and integration tests pass.
- [ ] Staging E2E tests pass for WhatsApp and Voice.
- [ ] Feature flags wired for all channel types.
- [ ] Runbook written for: WhatsApp webhook outage, voice call drops, provider credential rotation.

---

# Part 5 — Layer 3: Identity & Session

> Magic link auth · Voice OTP · Cross-channel sessions · Step-up auth · End-user → SaaS user mapping
> Depends on: Layer 1 (Foundations), Layer 2 (Channel Layer)
> Consumed by: Layer 4 (Playbook & Agent Runtime)

## 5.1 Goals

- Resolve who an inbound message is from — mapping a channel identifier (phone number, Slack user ID, browser session) to a verified end-user record tied to the SaaS tenant's system.
- Issue and validate short-lived session tokens so verified users don't re-authenticate on every message.
- Stitch sessions across channels — when a user moves from WhatsApp to voice to web chat, they are the same person with the same conversation history.
- Enforce step-up authentication for Tier 3 (destructive / financial) actions before execution.
- Never trust channel identifiers alone as proof of identity — a phone number can be spoofed, a Slack account can be compromised.

## 5.2 Non-goals (Layer 3)

- Does not decide what the user is allowed to do. That is the policy layer (Layer 5 / Part 7).
- Does not infer lifecycle state. That is the playbook engine (Layer 4 / Part 6).
- Does not store the SaaS company's user database. We store a mapping and a scoped token.
- Does not handle admin authentication. That is Clerk/WorkOS.

## 5.3 Core concepts

### Identity vs. Session vs. Verification

These are three distinct things that are often conflated:

- **Identity** — the binding between a channel identifier and a real person in the SaaS system.
- **Verification** — proof that the person controlling this channel identifier is who they claim to be.
- **Session** — a time-bounded window during which a verified identity can act without re-proving identity.

All three must be present before any action can be taken.

### The trust hierarchy

```
Channel identifier alone          → UNTRUSTED (spoofable)
Channel identifier + magic link   → VERIFIED (identity confirmed)
Verified + active session         → AUTHENTICATED (can act within session)
Authenticated + step-up           → ELEVATED (can perform Tier 3 actions)
```

## 5.4 End-user identity model

```typescript
// packages/types/src/identity.ts

export interface EndUserIdentity {
  id: string;
  tenantId: string;
  externalUserId: string;
  verificationStatus: VerificationStatus;
  verifiedAt?: Date;
  verificationChannel?: ChannelType;
  channels: IdentityChannel[];
  encryptedAccessToken?: string;
  tokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdentityChannel {
  id: string;
  identityId: string;
  channelType: ChannelType;
  identifier: string;
  linkedAt: Date;
  lastSeenAt: Date;
  trusted: boolean;
}

export enum VerificationStatus {
  Unverified = 'unverified',
  PendingMagicLink = 'pending_magic_link',
  PendingOTP = 'pending_otp',
  Verified = 'verified',
}

export interface EndUserSession {
  id: string;
  identityId: string;
  tenantId: string;
  token: string;
  channels: ChannelType[];
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  stepUpCompletedAt?: Date;
  stepUpExpiresAt?: Date;
  metadata: Record<string, unknown>;
}
```

## 5.5 Magic link flow (WhatsApp, SMS, Web)

This is the primary first-touch verification flow for all non-voice channels.

```
End user sends first message on WhatsApp
          │
          ▼
Layer 2 normalizes → Layer 3 receives InboundMessage
          │
          ▼
Look up IdentityChannel by (tenantId, channelType, identifier)
          │
     ┌────┴────┐
  Found?      Not found
     │              │
     ▼              ▼
Check session    Create EndUserIdentity (unverified)
valid?           Create IdentityChannel (trusted: false)
     │           Send magic link message
  ┌──┴──┐              │
Valid  Expired          ▼
  │       │      User clicks magic link
  ▼       │             │
Proceed   │             ▼
to Layer 4│      Verify token (not expired, not used)
          │      Mark identity as verified
          │      Mark channel as trusted
          │      Fetch SaaS user context (call SaaS API)
          │      Store encrypted access token
          │      Create session
          │             │
          └─────────────┘
                        │
                        ▼
                  Proceed to Layer 4
```

```typescript
// apps/api/src/identity/magic-link.service.ts

export class MagicLinkService {

  async initiateVerification(
    tenantId: string,
    channelType: ChannelType,
    identifier: string,
  ): Promise<void> {
    // 1. Find or create the identity record
    let identity = await this.identityRepo.findByChannel(tenantId, channelType, identifier);
    if (!identity) {
      identity = await this.identityRepo.create({ tenantId, channelType, identifier });
    }

    // 2. Generate a signed token — short-lived (15 min), single-use
    const token = signToken({
      tenantId,
      endUserId: identity.id,
      purpose: 'magic_link',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000,
    }, 900);

    // 3. Persist the pending token (for single-use enforcement)
    await this.redis.set(
      `magic_link:${token}`,
      JSON.stringify({ identityId: identity.id, tenantId, used: false }),
      'EX', 900
    );

    // 4. Build verification URL
    const verificationUrl = `${config.BASE_URL}/verify/${token}`;

    // 5. Send the message via outbound queue
    await this.outboundQueue.add('send_message', {
      tenantId,
      channelType,
      to: { identifier },
      content: {
        type: 'magic_link',
        text: await this.getMagicLinkCopy(tenantId),
        url: verificationUrl,
      },
    });

    await this.identityRepo.updateStatus(identity.id, VerificationStatus.PendingMagicLink);
  }

  async verifyMagicLink(token: string): Promise<VerifyResult> {
    // 1. Validate the token signature and expiry
    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch {
      throw Errors.unauthorized('Verification link is invalid or has expired.');
    }

    if (payload.purpose !== 'magic_link') {
      throw Errors.unauthorized('Invalid token purpose.');
    }

    // 2. Enforce single-use
    const stored = await this.redis.get(`magic_link:${token}`);
    if (!stored) throw Errors.unauthorized('Verification link has already been used or expired.');
    const record = JSON.parse(stored);
    if (record.used) throw Errors.unauthorized('Verification link has already been used.');

    // 3. Mark as used atomically
    await this.redis.set(
      `magic_link:${token}`,
      JSON.stringify({ ...record, used: true }),
      'KEEPTTL'
    );

    // 4. Fetch the user context from the SaaS company's API
    const saasContext = await this.integrationService.fetchUserContext(
      payload.tenantId,
      payload.endUserId
    );

    // 5. Store the encrypted access token
    const encryptedToken = await encrypt(saasContext.accessToken);
    await this.identityRepo.storeAccessToken(
      payload.endUserId,
      encryptedToken,
      saasContext.tokenExpiresAt
    );

    // 6. Mark identity as verified and channel as trusted
    await this.identityRepo.markVerified(payload.endUserId, saasContext.externalUserId);

    // 7. Create a session
    const session = await this.sessionService.create(payload.tenantId, payload.endUserId);

    // 8. Emit audit event
    await this.auditService.emit({
      tenantId: payload.tenantId,
      endUserId: payload.endUserId,
      eventType: 'user.verified',
      payload: { channel: record.channelType, method: 'magic_link' },
    });

    return { session, saasContext };
  }
}
```

## 5.6 Voice OTP flow

Voice cannot use clickable links. Two modes depending on the caller's setup.

```typescript
// apps/voice-worker/src/identity/voice-otp.service.ts

export class VoiceOTPService {

  async initiate(session: VoiceSession): Promise<VoiceOTPResult> {
    const otp = this.generateOTP();

    await this.redis.set(
      `voice_otp:${session.id}`,
      JSON.stringify({ otp, attempts: 0, verified: false }),
      'EX', 300
    );

    // Primary: SMS to calling number
    const smsSent = await this.trySendOTPViaSMS(session.from, otp, session.tenantId);

    if (smsSent) {
      return {
        mode: 'sms_otp',
        twiml: twiml
          .say("I've sent a 6-digit verification code to your phone number. Please enter it using your keypad.")
          .gather({
            input: 'dtmf',
            numDigits: 6,
            timeout: 30,
            action: `/voice/verify-otp/${session.id}`,
            method: 'POST',
          })
          .say("I didn't receive your input. Let me try again.")
          .gather({
            input: 'dtmf',
            numDigits: 6,
            timeout: 30,
            action: `/voice/verify-otp/${session.id}`,
          }),
      };
    }

    // Fallback: read out a code, ask them to enter via keypad
    return {
      mode: 'spoken_otp',
      twiml: twiml
        .say(`Your verification code is: ${otp.split('').join(', ')}.`)
        .say('Please enter this code using your phone keypad.')
        .gather({
          input: 'dtmf',
          numDigits: 6,
          timeout: 45,
          action: `/voice/verify-otp/${session.id}`,
        }),
    };
  }

  async verify(sessionId: string, enteredDigits: string): Promise<boolean> {
    const raw = await this.redis.get(`voice_otp:${sessionId}`);
    if (!raw) throw Errors.unauthorized('OTP expired.');

    const record = JSON.parse(raw);

    if (record.attempts >= 3) {
      await this.redis.del(`voice_otp:${sessionId}`);
      throw Errors.unauthorized('Too many incorrect attempts.');
    }

    if (enteredDigits !== record.otp) {
      await this.redis.set(
        `voice_otp:${sessionId}`,
        JSON.stringify({ ...record, attempts: record.attempts + 1 }),
        'KEEPTTL'
      );
      return false;
    }

    await this.redis.del(`voice_otp:${sessionId}`);
    return true;
  }

  private generateOTP(): string {
    // Use crypto.randomInt — Math.random() is NOT cryptographically secure
    const digits = Array.from({ length: 6 }, () => crypto.randomInt(0, 10));
    return digits.join('');
  }
}
```

## 5.7 Session management

Sessions stored in Redis (fast lookup, automatic TTL) with a lightweight reference in Postgres (for audit and cross-session queries).

```typescript
// apps/api/src/identity/session.service.ts

export class SessionService {

  private readonly DEFAULT_SESSION_TTL_DAYS = 30;
  private readonly STEP_UP_TTL_MINUTES = 15;

  async create(tenantId: string, identityId: string): Promise<EndUserSession> {
    const session: EndUserSession = {
      id: ulid(),
      identityId,
      tenantId,
      token: this.generateSessionToken(tenantId, identityId),
      channels: [],
      createdAt: new Date(),
      expiresAt: addDays(new Date(), this.DEFAULT_SESSION_TTL_DAYS),
      lastActivityAt: new Date(),
      metadata: {},
    };

    // Primary storage: Redis
    await this.redis.set(
      `session:${session.id}`,
      JSON.stringify(session),
      'EX', this.DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60
    );

    // Lookup index by identityId
    await this.redis.set(
      `session_by_identity:${tenantId}:${identityId}`,
      session.id,
      'EX', this.DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60
    );

    // Lightweight reference in Postgres
    await this.sessionRepo.createReference({
      id: session.id,
      identityId,
      tenantId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });

    return session;
  }

  async resolve(tenantId: string, channelType: ChannelType, identifier: string): Promise<SessionResolveResult> {
    const identityChannel = await this.identityRepo.findChannel(tenantId, channelType, identifier);
    if (!identityChannel) {
      return { status: 'unknown' };
    }

    if (!identityChannel.trusted) {
      return { status: 'unverified', identityId: identityChannel.identityId };
    }

    const sessionId = await this.redis.get(
      `session_by_identity:${tenantId}:${identityChannel.identityId}`
    );
    if (!sessionId) {
      return { status: 'session_expired', identityId: identityChannel.identityId };
    }

    const raw = await this.redis.get(`session:${sessionId}`);
    if (!raw) {
      return { status: 'session_expired', identityId: identityChannel.identityId };
    }

    const session: EndUserSession = JSON.parse(raw);

    // Slide session expiry on activity (rolling window)
    session.lastActivityAt = new Date();
    if (!session.channels.includes(channelType)) {
      session.channels.push(channelType);
    }
    await this.redis.set(
      `session:${sessionId}`,
      JSON.stringify(session),
      'EX', this.DEFAULT_SESSION_TTL_DAYS * 24 * 60 * 60
    );

    return { status: 'active', session };
  }

  async initiateStepUp(sessionId: string, tenantId: string, identityId: string): Promise<void> {
    const token = signToken({
      tenantId,
      endUserId: identityId,
      purpose: 'step_up',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
    }, 300);

    await this.redis.set(`step_up:${token}`, sessionId, 'EX', 300);

    await this.outboundQueue.add('send_step_up_link', {
      sessionId, tenantId, identityId, token,
    });
  }

  async completeStepUp(token: string): Promise<void> {
    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch {
      throw Errors.unauthorized('Step-up verification link is invalid or expired.');
    }
    if (payload.purpose !== 'step_up') throw Errors.unauthorized('Invalid token purpose.');

    const sessionId = await this.redis.get(`step_up:${token}`);
    if (!sessionId) throw Errors.unauthorized('Step-up link already used or expired.');

    const raw = await this.redis.get(`session:${sessionId}`);
    if (!raw) throw Errors.unauthorized('Session not found.');

    const session: EndUserSession = JSON.parse(raw);
    session.stepUpCompletedAt = new Date();
    session.stepUpExpiresAt = addMinutes(new Date(), this.STEP_UP_TTL_MINUTES);

    await this.redis.set(`session:${sessionId}`, JSON.stringify(session), 'KEEPTTL');
    await this.redis.del(`step_up:${token}`);

    await this.auditService.emit({
      tenantId: payload.tenantId,
      endUserId: payload.endUserId,
      eventType: 'user.step_up_completed',
      payload: {},
    });
  }

  isStepUpValid(session: EndUserSession): boolean {
    if (!session.stepUpCompletedAt || !session.stepUpExpiresAt) return false;
    return new Date() < session.stepUpExpiresAt;
  }
}
```

## 5.8 Cross-channel session stitching

Stitching trust rules:

| Incoming channel | Existing verified channel | Action |
|---|---|---|
| Web chat + SaaS token | Any | Auto-stitch, trusted |
| Voice call (ANI match) | WhatsApp/SMS with same number | Auto-stitch, trusted |
| Voice call (ANI match) | None | Require OTP |
| WhatsApp | Web chat session only | Require magic link |
| New phone number | Any identity | Require magic link |

```typescript
// Scenario: User is verified on WhatsApp. Opens web chat with SaaS session token.
export async function stitchWebChatToIdentity(
  tenantId: string,
  widgetSessionId: string,
  saasSessionToken: string,
): Promise<void> {
  // 1. Validate the SaaS session token with the SaaS company's API
  const saasUser = await integrationService.validateSaaSToken(tenantId, saasSessionToken);

  // 2. Find the existing identity by externalUserId
  let identity = await identityRepo.findByExternalUserId(tenantId, saasUser.externalUserId);

  if (!identity) {
    identity = await identityRepo.create({ tenantId, externalUserId: saasUser.externalUserId });
  }

  // 3. Link this browser session as a trusted channel
  await identityRepo.linkChannel(identity.id, {
    channelType: ChannelType.WebChat,
    identifier: widgetSessionId,
    trusted: true,
  });

  await sessionService.getOrCreate(tenantId, identity.id);
}

// Scenario: User calls in. Phone matches WhatsApp-verified identity. Auto-stitch.
export async function stitchVoiceToExistingIdentity(
  tenantId: string,
  callerNumber: string,
): Promise<StitchResult> {
  const existing = await identityRepo.findChannel(
    tenantId, ChannelType.WhatsApp, callerNumber
  ) ?? await identityRepo.findChannel(
    tenantId, ChannelType.SMS, callerNumber
  );

  if (existing?.trusted) {
    await identityRepo.linkChannel(existing.identityId, {
      channelType: ChannelType.Voice,
      identifier: callerNumber,
      trusted: true,
    });
    return { status: 'stitched', identityId: existing.identityId };
  }

  return { status: 'requires_otp' };
}
```

## 5.9 SaaS user context fetch

On first verification, and again on session start if context is stale, we fetch user metadata from the SaaS company's API. This context feeds state inference (Layer 4).

```typescript
export class UserContextService {

  async fetchAndCache(tenantId: string, externalUserId: string): Promise<UserContext> {
    const cacheKey = `user_context:${tenantId}:${externalUserId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Fetch from SaaS API via the integration layer (auth proxy)
    const raw = await this.integrationService.callEndpoint(tenantId, {
      endpointKey: 'user_context',
      pathParams: { userId: externalUserId },
    });

    const context: UserContext = {
      externalUserId,
      displayName: raw.name ?? raw.displayName,
      email: raw.email,
      plan: raw.plan ?? raw.subscription?.plan,
      accountCreatedAt: raw.createdAt ?? raw.created_at,
      lastLoginAt: raw.lastLogin ?? raw.last_login_at,
      metadata: raw,
    };

    // 5-minute TTL — fresh enough for state inference, not too stale
    await this.redis.set(cacheKey, JSON.stringify(context), 'EX', 300);
    return context;
  }
}

export interface UserContext {
  externalUserId: string;
  displayName?: string;
  email?: string;
  plan?: string;
  accountCreatedAt?: string;
  lastLoginAt?: string;
  metadata: Record<string, unknown>;
}
```

## 5.10 Database schema — identity & session tables

```typescript
// packages/db/src/schema/identity.ts

export const verificationStatusEnum = pgEnum('verification_status',
  ['unverified', 'pending_magic_link', 'pending_otp', 'verified']);

export const endUserIdentities = pgTable('end_user_identities', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull().references(() => tenants.id),
  externalUserId:       varchar('external_user_id', { length: 255 }),
  verificationStatus:   verificationStatusEnum('verification_status').notNull().default('unverified'),
  verifiedAt:           timestamp('verified_at'),
  verificationChannel:  varchar('verification_channel', { length: 50 }),
  encryptedAccessToken: text('encrypted_access_token'),
  tokenExpiresAt:       timestamp('token_expires_at'),
  contextCachedAt:      timestamp('context_cached_at'),
  createdAt:            timestamp('created_at').notNull().defaultNow(),
  updatedAt:            timestamp('updated_at').notNull().defaultNow(),
});
// Unique index on (tenant_id, external_user_id)

export const identityChannels = pgTable('identity_channels', {
  id:           uuid('id').primaryKey().defaultRandom(),
  identityId:   uuid('identity_id').notNull().references(() => endUserIdentities.id),
  tenantId:     uuid('tenant_id').notNull(),
  channelType:  varchar('channel_type', { length: 50 }).notNull(),
  identifier:   varchar('identifier', { length: 255 }).notNull(),
  trusted:      boolean('trusted').notNull().default(false),
  linkedAt:     timestamp('linked_at').notNull().defaultNow(),
  lastSeenAt:   timestamp('last_seen_at').notNull().defaultNow(),
});
// Unique index on (tenant_id, channel_type, identifier)

export const sessionReferences = pgTable('session_references', {
  id:           uuid('id').primaryKey(),
  identityId:   uuid('identity_id').notNull().references(() => endUserIdentities.id),
  tenantId:     uuid('tenant_id').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  expiresAt:    timestamp('expires_at').notNull(),
  revokedAt:    timestamp('revoked_at'),
});
```

## 5.11 API endpoints (admin-facing)

```
GET    /api/v1/end-users                        List end users for tenant (paginated)
GET    /api/v1/end-users/:id                    Get identity + channel list + session status
DELETE /api/v1/end-users/:id/session            Revoke active session (force re-verify)
POST   /api/v1/end-users/:id/reset-verification Reset to unverified (e.g. phone change)
GET    /api/v1/end-users/:id/audit              Audit trail for this user

GET    /verify/:token                           Magic link verification page (public)
POST   /verify/:token                           Magic link completion
POST   /step-up/:token                          Step-up auth completion
```

## 5.12 Security considerations

- **Token entropy:** Magic link tokens from `crypto.randomBytes(32)` encoded as base64url — 256 bits.
- **Token binding:** Tokens bound to `tenantId` + `endUserId` + `purpose`. A magic-link token cannot be reused as step-up.
- **Single-use enforcement:** Redis SET with KEEPTTL marks used atomically — race condition (double-click) handled.
- **Channel spoofing:** WhatsApp phone numbers can theoretically be spoofed at the SIM level. We mitigate by: never executing Tier 2/3 without active verified session, requiring step-up for Tier 3 even within valid session.
- **Session fixation:** Sessions created fresh on each verification. Old IDs cannot be reused.
- **Token storage:** Magic link tokens NOT in DB. Redis only with TTL. A DB breach does not expose unverified tokens.
- **Step-up window:** 15 minutes. After that, any Tier 3 action requires another step-up.
- **Admin revocation:** Immediate. Writes `revokedAt` to Postgres AND deletes Redis key. No grace period.

## 5.13 Acceptance criteria

**Given** a new end user sends their first WhatsApp message
**When** their phone number is not in the identity database
**Then** an identity record is created, a magic link is sent within 5 seconds, and the message is queued but not processed until verification completes.

**Given** a user clicks a magic link
**When** the token is valid, unexpired, and unused
**Then** the identity is marked verified, a session is created, the token is marked used in Redis, and an audit event is emitted.

**Given** a user clicks the same magic link a second time
**When** the token is already marked as used
**Then** the response is 401 with a "link already used" message. No new session is created.

**Given** a magic link token has expired (>15 minutes old)
**When** the user clicks the link
**Then** the response is 401 with a "link expired" message.

**Given** a verified user sends a WhatsApp message within their session window
**When** Layer 3 resolves their identity
**Then** the session is returned as active and the session expiry is extended.

**Given** a verified user's session has expired
**When** they send a new message
**Then** they receive a re-verification message with a new magic link before their message is processed.

**Given** a voice caller's phone number matches an existing WhatsApp-verified identity
**When** they call in for the first time
**Then** their voice channel is auto-stitched without requiring OTP.

**Given** a Tier 3 action is requested during an active session
**When** step-up has not been completed in the last 15 minutes
**Then** the action is blocked, a step-up link is sent, and the action is held pending step-up completion.

**Given** an admin revokes an end user's session
**When** that user's next message arrives
**Then** they are treated as unauthenticated and must re-verify — even if the Redis TTL has not expired.

**Given** the same message arrives 3 times within 30 seconds (network retry)
**When** identity resolution runs
**Then** the session is resolved once; the message is not triplicated.

## 5.14 Test cases

### Unit tests

| Test | What it verifies |
|---|---|
| `generateOTP` returns a 6-digit numeric string | Format correctness |
| `generateOTP` called 1000 times produces no duplicate in the set | Statistical uniqueness |
| `initiateVerification` creates identity record on first call | New user path |
| `initiateVerification` does not create duplicate on second call | Idempotency |
| `verifyMagicLink` marks token as used after first call | Single-use enforcement |
| `verifyMagicLink` with `used: true` throws UNAUTHORIZED | Double-use rejection |
| `verifyMagicLink` with expired token throws UNAUTHORIZED | Expiry enforcement |
| `verifyMagicLink` with wrong `purpose` throws UNAUTHORIZED | Token binding |
| `isStepUpValid` returns false when `stepUpExpiresAt` is past | Step-up TTL |
| `isStepUpValid` returns false when no step-up done | No step-up |
| `resolve` returns `session_expired` when Redis key missing | Expired session |
| `resolve` extends session TTL on each call | Rolling window |
| `stitchVoiceToExistingIdentity` auto-stitches matching phone | Auto-stitch logic |
| `stitchVoiceToExistingIdentity` requires OTP for unknown number | Unknown caller |

### Integration tests

| Test | What it verifies |
|---|---|
| Full magic link flow: first message → link sent → click → session created → second message proceeds | Happy path E2E |
| Session expiry: create session, expire in Redis, send message → re-verification triggered | Expiry + re-verify |
| Step-up flow: Tier 3 action blocked → step-up link sent → click → action proceeds | Step-up E2E |
| Admin revoke: revoke session via API → next message triggers re-verification | Revocation |
| Cross-channel stitch: verify on WA → send message on web chat with SaaS token → same session | Stitching |
| Concurrent magic link clicks: two requests simultaneously → one succeeds, one rejected | Race condition |

### Security tests

| Test | What it verifies |
|---|---|
| Token with modified payload but valid signature is rejected | Tamper detection |
| Step-up token cannot be used as magic link and vice versa | Purpose binding |
| Session token from tenant A cannot resolve a session for tenant B | Tenant isolation |
| Revoked session key absent from Redis immediately after revoke | Immediate revocation |
| 4th incorrect OTP attempt invalidates the OTP and terminates the voice session | Brute force protection |

## 5.15 Definition of done for Layer 3

- [ ] All identity types exported from `packages/types`.
- [ ] All Postgres tables in 5.10 created via migrations.
- [ ] `MagicLinkService`: initiate and verify flows, single-use enforced, audit events emitted.
- [ ] `VoiceOTPService`: SMS OTP (primary) and DTMF spoken OTP (fallback) both working.
- [ ] `SessionService`: create, resolve (rolling window), step-up initiate/complete, admin revoke.
- [ ] Cross-channel stitching: web chat via SaaS token and voice via ANI match implemented.
- [ ] `UserContextService`: fetch and 5-minute cache.
- [ ] All admin API endpoints implemented.
- [ ] Magic link verification page hosted and functional (minimal hosted page in V1).
- [ ] All acceptance criteria pass.
- [ ] All unit and integration tests pass with ≥80% coverage.
- [ ] Security tests all pass.
- [ ] Runbook: magic link delivery failure, voice OTP retry loop, session mass-revocation.

---

# Part 6 — Layer 4: Playbook & Agent Runtime

> State inference · Playbook engine · LLM orchestration · Tool execution · RAG · Memory · Fallback ladder · Trigger system
> Depends on: Layers 1, 2, 3
> Consumed by: Layer 5 (Integration & Policy), Layer 6 (Admin & Config)

## 6.1 Goals

- Infer the end user's lifecycle state from conversation signals, action history, and SaaS context — continuously, on every turn.
- Load the correct playbook version for the tenant and resolve the active behavior bundle for the user's current state.
- Evaluate triggers against every inbound message and transition state or fire actions when conditions are met.
- Orchestrate the LLM: build the right context window, attach the right tools, enforce the right constraints, stream the response.
- Execute tool calls through the policy layer (Layer 5 / Part 7) and return results to the LLM for final response generation.
- Run the RAG pipeline to ground responses in the tenant's knowledge base.
- Maintain short-term, working, and long-term memory across turns and sessions.
- Run the fallback ladder when the bot fails to understand, when actions fail, or when confidence drops below threshold.
- Emit structured telemetry on every turn for billing, debugging, and the eval harness.

## 6.2 Non-goals (Layer 4)

- Does not validate action permissions or enforce risk tiers. That is Layer 5 / Part 7.
- Does not handle channel delivery. That is Layer 2.
- Does not manage identity or sessions. That is Layer 3.
- Does not manage the admin UI for playbook editing. That is Layer 6 / Part 8.
- Does not run LLM evals or regression tests. That is the eval runner (Part 11).

## 6.3 Runtime flow (every turn)

This is the critical path. Every inbound message follows this sequence exactly.

```
InboundMessage arrives from queue (enqueued by Layer 2)
        │
        ▼
1. RESOLVE IDENTITY & SESSION (Layer 3)
   └─ Get EndUserIdentity, EndUserSession, UserContext
        │
        ▼
2. LOAD CONVERSATION
   └─ Get or create Conversation record
   └─ Load last N turns from memory
        │
        ▼
3. INFER USER STATE
   └─ Run StateInferenceEngine with (UserContext, conversationHistory, actionHistory)
   └─ Update EndUser.currentUserState if confidence >= threshold
        │
        ▼
4. LOAD PLAYBOOK
   └─ Get active playbook version for tenant
   └─ Resolve BehaviorBundle for currentUserState
        │
        ▼
5. EVALUATE TRIGGERS
   └─ Run TriggerEngine against (message, conversationHistory, currentState)
   └─ If trigger fires → execute trigger action
   └─ If escalation triggered → hand off to Layer 6 inbox, stop here
        │
        ▼
6. BUILD AGENT CONTEXT
   └─ Compose system prompt from BehaviorBundle
   └─ Attach allowed tools for this state (from BehaviorBundle + policy layer)
   └─ Run RAG retrieval → inject relevant KB chunks
   └─ Append conversation history (within token budget)
        │
        ▼
7. LLM CALL (streaming)
   └─ Send to LLMProvider via packages/llm
   └─ Stream tokens to channel layer for real-time delivery (voice/web)
   └─ Collect tool call requests from streamed response
        │
        ▼
8. TOOL EXECUTION LOOP
   └─ For each tool call:
      a. Validate via Layer 5 policy (permission, tier, rate limit)
      b. If Tier 1+: send confirmation message, wait for user response
      c. If Tier 3: check step-up, initiate if needed
      d. Execute action via Layer 5 integration proxy
      e. Return result to LLM for next generation step
   └─ Loop until LLM produces a final text response (no more tool calls)
        │
        ▼
9. CONFIDENCE CHECK + FALLBACK
   └─ Score response confidence
   └─ If below threshold → run FallbackLadder
   └─ If above threshold → proceed
        │
        ▼
10. PERSIST TURN
    └─ Write Turn to DB
    └─ Update conversation memory
    └─ Emit telemetry event
    └─ Update user state if changed
        │
        ▼
11. DELIVER RESPONSE
    └─ Send OutboundMessage via Layer 2
```

## 6.4 State inference engine

```typescript
// apps/api/src/playbook/state-inference.engine.ts

export interface StateInferenceInput {
  tenantId: string;
  identityId: string;
  currentState: string;
  stateConfidence: number;
  userContext: UserContext;
  conversationHistory: Turn[];
  actionHistory: ActionInvocation[];
  currentMessage: string;
}

export interface StateInferenceResult {
  state: string;
  confidence: number;
  signals: StateSignal[];
  shouldUpdate: boolean;
}

export interface StateSignal {
  source: 'conversation' | 'action_history' | 'saas_context';
  signal: string;
  weight: number;
  pointsTo: string;
}

export class StateInferenceEngine {

  private readonly UPDATE_THRESHOLD = 0.65;

  async infer(input: StateInferenceInput): Promise<StateInferenceResult> {
    const playbook = await this.playbookRepo.getActive(input.tenantId);
    const stateDefinitions = playbook.lifecycle.states;

    // Collect signals from all three sources in parallel
    const [conversationSignals, actionSignals, contextSignals] = await Promise.all([
      this.extractConversationSignals(input.currentMessage, input.conversationHistory, stateDefinitions),
      this.extractActionSignals(input.actionHistory, stateDefinitions),
      this.extractContextSignals(input.userContext, stateDefinitions),
    ]);

    const allSignals = [...conversationSignals, ...actionSignals, ...contextSignals];

    // Score each state by summing weighted signal contributions
    const scores = this.scoreStates(allSignals, stateDefinitions);
    const topState = scores.sort((a, b) => b.score - a.score)[0];

    const shouldUpdate = topState.score >= this.UPDATE_THRESHOLD &&
      (topState.state !== input.currentState || Math.abs(topState.score - input.stateConfidence) > 0.1);

    return {
      state: shouldUpdate ? topState.state : input.currentState,
      confidence: topState.score,
      signals: allSignals,
      shouldUpdate,
    };
  }

  // Conversation signals — LLM classifier call (cheap, small model, fast)
  private async extractConversationSignals(
    currentMessage: string,
    history: Turn[],
    states: PlaybookState[],
  ): Promise<StateSignal[]> {
    const recentText = history
      .slice(-6)
      .filter(t => t.role === 'user')
      .map(t => (t.content as TextContent).text)
      .join('\n');

    const response = await this.llm.complete({
      model: 'claude-haiku-4-5',
      systemPrompt: buildSignalClassifierPrompt(states),
      messages: [{
        role: 'user',
        content: `Recent messages:\n${recentText}\n\nCurrent message: ${currentMessage}\n\nReturn signals as JSON array.`,
      }],
      maxTokens: 300,
    });

    return parseSignalsJSON(response.content);
  }

  // Action signals
  private extractActionSignals(
    history: ActionInvocation[],
    states: PlaybookState[],
  ): StateSignal[] {
    const signals: StateSignal[] = [];
    const recent = history.slice(-20);

    const cancelRelatedActions = recent.filter(a =>
      a.actionKey.includes('cancel') || a.actionKey.includes('downgrade')
    );
    if (cancelRelatedActions.length >= 2) {
      signals.push({
        source: 'action_history',
        signal: `Performed ${cancelRelatedActions.length} cancellation-related actions recently`,
        weight: 0.4,
        pointsTo: 'at_risk',
      });
    }

    const failedActions = recent.filter(a => !a.success);
    if (failedActions.length >= 3) {
      signals.push({
        source: 'action_history',
        signal: 'Multiple recent action failures — possible frustration',
        weight: 0.2,
        pointsTo: 'at_risk',
      });
    }

    const highValueActions = recent.filter(a =>
      a.actionKey.includes('upgrade') || a.actionKey.includes('add_seat')
    );
    if (highValueActions.length >= 1) {
      signals.push({
        source: 'action_history',
        signal: 'Recent upgrade or expansion action',
        weight: 0.3,
        pointsTo: 'power_user',
      });
    }

    return signals;
  }

  // Context signals from SaaS API
  private extractContextSignals(
    context: UserContext,
    states: PlaybookState[],
  ): StateSignal[] {
    const signals: StateSignal[] = [];

    if (!context.verifiedAt) {
      signals.push({
        source: 'saas_context',
        signal: 'Account not yet verified in SaaS system',
        weight: 0.9,
        pointsTo: 'unverified',
      });
      return signals;
    }

    const accountAgeDays = context.accountCreatedAt
      ? differenceInDays(new Date(), new Date(context.accountCreatedAt))
      : null;

    if (accountAgeDays !== null && accountAgeDays < 14) {
      signals.push({
        source: 'saas_context',
        signal: `Account created ${accountAgeDays} days ago`,
        weight: 0.5,
        pointsTo: 'early_user',
      });
    }

    const daysSinceLogin = context.lastLoginAt
      ? differenceInDays(new Date(), new Date(context.lastLoginAt))
      : null;

    if (daysSinceLogin !== null && daysSinceLogin > 30) {
      signals.push({
        source: 'saas_context',
        signal: `No login in ${daysSinceLogin} days`,
        weight: 0.45,
        pointsTo: 'at_risk',
      });
    }

    return signals;
  }
}
```

**Important evolution note:** the LLM classifier per turn is fine at low volume. At 10K conversations/day it adds latency and cost. The right evolution path: collect labeled data from production (state transitions + signals), train a lightweight classifier (logistic regression or small fine-tuned model) that replaces the LLM call for common cases. Build for the LLM version first; leave a clear interface to swap it out.

## 6.5 Playbook data model

```typescript
// packages/types/src/playbook.ts

export interface Playbook {
  id: string;
  tenantId: string;
  version: string;              // semver: "1.0.0", "1.1.0"
  status: PlaybookStatus;
  deploymentMode?: DeploymentMode;
  gradualRolloutPercent?: number;
  lifecycle: PlaybookLifecycle;
  triggers: PlaybookTrigger[];
  fallbackLadder: FallbackStep[];
  bootstrappedFromSpecId?: string;
  createdAt: Date;
  publishedAt?: Date;
}

export enum PlaybookStatus {
  Draft = 'draft',
  Shadow = 'shadow',
  Gradual = 'gradual',
  Active = 'active',
  Archived = 'archived',
}

export enum DeploymentMode {
  Immediate = 'immediate',
  Shadow = 'shadow',
  Gradual = 'gradual',
}

export interface PlaybookLifecycle {
  states: PlaybookState[];
  defaultState: string;
}

export interface PlaybookState {
  key: string;
  label: string;
  description: string;
  inferenceHints: string[];
  behavior: BehaviorBundle;
}

export interface BehaviorBundle {
  persona: string;
  toneGuidelines: string[];
  openingBehavior: OpeningBehavior;

  allowedActionKeys: string[];        // '*' means all allowed actions
  kbScopeIds: string[];               // Which KB collections are searchable
  skillPacks: string[];

  maxResponseLength?: number;
  confidenceFloor: number;            // Default 0.6
  requireConfirmationForTier: number; // Default 1
}

export enum OpeningBehavior {
  FullIntro = 'full_intro',
  BriefGreeting = 'brief_greeting',
  SkipToIntent = 'skip_to_intent',
  RetentionMode = 'retention_mode',
}

export interface PlaybookTrigger {
  id: string;
  label: string;
  enabled: boolean;
  event: TriggerEvent;
  condition: TriggerCondition;
  action: TriggerAction;
}

export type TriggerEvent =
  | { type: 'message_received' }
  | { type: 'action_succeeded'; actionKey: string }
  | { type: 'action_failed'; actionKey: string }
  | { type: 'state_entered'; state: string }
  | { type: 'session_started' }
  | { type: 'escalation_requested' };

export type TriggerCondition =
  | { type: 'message_contains'; phrases: string[]; matchType: 'any' | 'all' }
  | { type: 'message_intent'; intent: string; minConfidence: number }
  | { type: 'state_is'; state: string }
  | { type: 'action_count'; actionKey: string; operator: '>=' | '<='; count: number }
  | { type: 'consecutive_failures'; count: number }
  | { type: 'and'; conditions: TriggerCondition[] }
  | { type: 'or'; conditions: TriggerCondition[] };

export type TriggerAction =
  | { type: 'transition_state'; targetState: string }
  | { type: 'escalate_to_human'; reason: string; priority: 'normal' | 'urgent' }
  | { type: 'send_message'; templateKey: string }
  | { type: 'invoke_action'; actionKey: string; args?: Record<string, unknown> }
  | { type: 'set_metadata'; key: string; value: unknown };

export interface FallbackStep {
  order: number;
  strategy: FallbackStrategy;
  config: FallbackConfig;
}

export type FallbackStrategy =
  | 'typo_correction'
  | 'slot_reprompt'
  | 'rephrase'
  | 'offer_options'
  | 'escalate';

export interface FallbackConfig {
  maxAttempts: number;
  messageTemplate: string;
}
```

## 6.6 Playbook engine

```typescript
// apps/api/src/playbook/playbook.engine.ts

export class PlaybookEngine {

  async load(tenantId: string, conversationId: string): Promise<ResolvedPlaybook> {
    // Gradual rollout: deterministically assign this conversation to a playbook version
    const versions = await this.playbookRepo.getDeployedVersions(tenantId);
    const playbook = this.selectVersion(versions, conversationId);

    return {
      playbook,
      version: playbook.version,
      isExperiment: playbook.status !== PlaybookStatus.Active,
    };
  }

  // Deterministic assignment for gradual rollout
  private selectVersion(versions: Playbook[], conversationId: string): Playbook {
    const active = versions.find(v => v.status === PlaybookStatus.Active);
    const gradual = versions.find(v => v.status === PlaybookStatus.Gradual);

    if (!gradual) return active!;

    const hash = murmurhash(conversationId) % 100;
    return hash < gradual.gradualRolloutPercent! ? gradual : active!;
  }

  resolveBehaviorBundle(playbook: Playbook, userState: string): BehaviorBundle {
    const state = playbook.lifecycle.states.find(s => s.key === userState)
      ?? playbook.lifecycle.states.find(s => s.key === playbook.lifecycle.defaultState);

    if (!state) throw Errors.notFound('PlaybookState', userState);
    return state.behavior;
  }

  async evaluateTriggers(
    playbook: Playbook,
    input: TriggerEvaluationInput,
  ): Promise<TriggerFired[]> {
    const fired: TriggerFired[] = [];

    for (const trigger of playbook.triggers.filter(t => t.enabled)) {
      if (!this.eventMatches(trigger.event, input)) continue;

      const conditionMet = await this.evaluateCondition(trigger.condition, input);
      if (!conditionMet) continue;

      fired.push({ triggerId: trigger.id, action: trigger.action });
    }

    return fired;
  }

  private async evaluateCondition(
    condition: TriggerCondition,
    input: TriggerEvaluationInput,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'message_contains':
        return condition.matchType === 'any'
          ? condition.phrases.some(p => input.message.toLowerCase().includes(p.toLowerCase()))
          : condition.phrases.every(p => input.message.toLowerCase().includes(p.toLowerCase()));

      case 'message_intent':
        const intent = await this.classifyIntent(input.message, condition.intent);
        return intent.confidence >= condition.minConfidence;

      case 'state_is':
        return input.currentState === condition.state;

      case 'action_count':
        const count = input.actionHistory.filter(a => a.actionKey === condition.actionKey).length;
        return condition.operator === '>=' ? count >= condition.count : count <= condition.count;

      case 'consecutive_failures':
        const recent = input.actionHistory.slice(-condition.count);
        return recent.length === condition.count && recent.every(a => !a.success);

      case 'and':
        const andResults = await Promise.all(
          condition.conditions.map(c => this.evaluateCondition(c, input))
        );
        return andResults.every(Boolean);

      case 'or':
        const orResults = await Promise.all(
          condition.conditions.map(c => this.evaluateCondition(c, input))
        );
        return orResults.some(Boolean);
    }
  }
}
```

## 6.7 LLM abstraction (`packages/llm`)

Provider-agnostic. V1 ships with Anthropic as primary. Abstraction supports multi-model in V1.5 without rewrites.

```typescript
// packages/llm/src/index.ts

export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

export interface LLMStreamChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  text?: string;
  toolCall?: Partial<LLMToolCall>;
  usage?: { inputTokens: number; outputTokens: number };
}

// Factory: resolves the right provider + key for this tenant
export async function createLLMClient(tenantId: string): Promise<LLMClient> {
  const tenant = await tenantRepo.get(tenantId);
  const config = tenant.llmConfig;

  const apiKey = config.mode === 'byok'
    ? await decrypt(JSON.parse(config.encryptedApiKey))
    : getPlatformKey(config.provider);

  switch (config.provider) {
    case LLMProvider.Anthropic: return new AnthropicClient(apiKey, config.model);
    case LLMProvider.OpenAI:    return new OpenAIClient(apiKey, config.model);
    case LLMProvider.Google:    return new GoogleClient(apiKey, config.model);
  }
}

// Anthropic implementation
class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string, private model: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.systemPrompt,
      messages: req.messages.map(this.mapMessage),
      tools: req.tools?.map(this.mapTool),
    });

    return {
      content: response.content.filter(b => b.type === 'text').map(b => b.text).join(''),
      toolCalls: response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, args: b.input })),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: this.model,
      provider: LLMProvider.Anthropic,
      latencyMs: Date.now() - start,
    };
  }

  async *stream(req: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.systemPrompt,
      messages: req.messages.map(this.mapMessage),
      tools: req.tools?.map(this.mapTool),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text_delta', text: event.delta.text };
      }
      if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
        yield { type: 'tool_call_delta', toolCall: { args: event.delta.partial_json } };
      }
      if (event.type === 'message_stop') {
        yield { type: 'done', usage: {
          inputTokens: stream.usage?.input_tokens ?? 0,
          outputTokens: stream.usage?.output_tokens ?? 0,
        }};
      }
    }
  }
}
```

## 6.8 Agent context builder

```typescript
// apps/api/src/agent/context-builder.ts

export class AgentContextBuilder {

  async build(input: ContextBuildInput): Promise<AgentContext> {
    const { behavior, conversation, identity, userContext, currentMessage, allowedTools } = input;

    const systemPrompt = this.buildSystemPrompt(behavior, userContext, conversation);

    // RAG retrieval and history load in parallel
    const [kbChunks, history] = await Promise.all([
      this.ragService.retrieve(input.tenantId, currentMessage, behavior.kbScopeIds),
      this.memoryService.getHistory(conversation.id, MAX_HISTORY_TURNS),
    ]);

    const messages: LLMMessage[] = [
      ...history.map(this.turnToMessage),
      ...(kbChunks.length > 0 ? [{
        role: 'user' as const,
        content: buildRAGContextBlock(kbChunks),
      }] : []),
      { role: 'user', content: currentMessage },
    ];

    const trimmedMessages = this.enforceTokenBudget(messages, systemPrompt, allowedTools);

    return { systemPrompt, messages: trimmedMessages, tools: allowedTools };
  }

  private buildSystemPrompt(
    behavior: BehaviorBundle,
    userContext: UserContext,
    conversation: Conversation,
  ): string {
    return `
You are an AI assistant for ${userContext.tenantName}.
${behavior.persona}

Tone guidelines:
${behavior.toneGuidelines.map(g => `- ${g}`).join('\n')}

The user's name is ${userContext.displayName ?? 'the user'}.
Their account plan is ${userContext.plan ?? 'unknown'}.
Current date and time: ${new Date().toISOString()}

You may only perform the actions described in the tools provided.
You must not discuss, suggest, or imply actions outside of what is explicitly available.
If asked to do something you cannot do, say so clearly and offer what you can do instead.

${behavior.requireConfirmationForTier <= 1
  ? 'Before taking any action that modifies data, confirm with the user first.'
  : 'You may take read actions immediately. For write actions, confirm first.'}

Response length: keep responses concise and focused.
${behavior.maxResponseLength ? `Maximum response length: ${behavior.maxResponseLength} characters.` : ''}
`.trim();
  }

  private enforceTokenBudget(
    messages: LLMMessage[],
    systemPrompt: string,
    tools: LLMTool[],
  ): LLMMessage[] {
    const systemTokens = estimateTokens(systemPrompt);
    const toolTokens = tools.reduce((sum, t) => sum + estimateTokens(JSON.stringify(t)), 0);
    const reservedForResponse = 1024;
    const budget = MODEL_CONTEXT_LIMIT - systemTokens - toolTokens - reservedForResponse;

    let total = 0;
    const kept: LLMMessage[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(JSON.stringify(messages[i]));
      if (total + tokens > budget) break;
      kept.unshift(messages[i]);
      total += tokens;
    }

    return kept;
  }
}
```

## 6.9 RAG pipeline

```typescript
// apps/api/src/rag/retrieval.service.ts

export class RAGRetrievalService {

  async retrieve(
    tenantId: string,
    query: string,
    kbScopeIds: string[],
  ): Promise<KBChunk[]> {
    if (kbScopeIds.length === 0) return [];

    const queryEmbedding = await this.embedder.embed(query);

    // Hybrid: semantic (vector) + keyword (BM25 via Postgres FTS)
    const [semanticResults, keywordResults] = await Promise.all([
      this.vectorStore.search(tenantId, queryEmbedding, kbScopeIds, { topK: 10 }),
      this.keywordStore.search(tenantId, query, kbScopeIds, { topK: 10 }),
    ]);

    // Reciprocal rank fusion
    const fused = this.reciprocalRankFusion(semanticResults, keywordResults);

    // Re-rank
    const reranked = await this.reranker.rerank(query, fused.slice(0, 20));

    return reranked
      .filter(r => r.score >= MIN_RELEVANCE_SCORE)
      .slice(0, MAX_CONTEXT_CHUNKS);
  }

  private reciprocalRankFusion(
    semantic: RankedChunk[],
    keyword: RankedChunk[],
    k = 60,
  ): RankedChunk[] {
    const scores = new Map<string, number>();

    for (const [i, chunk] of semantic.entries()) {
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + i + 1));
    }
    for (const [i, chunk] of keyword.entries()) {
      scores.set(chunk.id, (scores.get(chunk.id) ?? 0) + 1 / (k + i + 1));
    }

    const allChunks = [...new Map([...semantic, ...keyword].map(c => [c.id, c])).values()];
    return allChunks.sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
  }
}

function buildRAGContextBlock(chunks: KBChunk[]): string {
  return [
    '<knowledge_base_context>',
    'The following information is from the official knowledge base. Use it to answer questions accurately.',
    ...chunks.map(c => `Source: ${c.sourceTitle}\n${c.content}`),
    '</knowledge_base_context>',
  ].join('\n\n');
}

// KB chunk DB schema
export const kbChunks = pgTable('kb_chunks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenantId:     uuid('tenant_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  sourceId:     uuid('source_id').notNull(),
  sourceTitle:  text('source_title').notNull(),
  content:      text('content').notNull(),
  embedding:    vector('embedding', { dimensions: 1536 }),
  tokenCount:   integer('token_count').notNull(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
});
// Index: ivfflat on embedding for ANN search
// Index: GIN on content for FTS
// Index: (tenant_id, collection_id)
```

## 6.10 Memory system

```typescript
// Three memory types, each with different scope and TTL

export class MemoryService {

  // SHORT-TERM: last N turns of the current conversation
  async getHistory(conversationId: string, maxTurns = 20): Promise<Turn[]> {
    return this.turnRepo.getRecent(conversationId, maxTurns);
  }

  // WORKING MEMORY: named entities and slot values within a session
  async getWorkingMemory(sessionId: string): Promise<WorkingMemory> {
    const raw = await this.redis.get(`working_memory:${sessionId}`);
    return raw ? JSON.parse(raw) : { entities: {}, slots: {} };
  }

  async updateWorkingMemory(sessionId: string, updates: Partial<WorkingMemory>): Promise<void> {
    const current = await this.getWorkingMemory(sessionId);
    const updated = {
      entities: { ...current.entities, ...updates.entities },
      slots: { ...current.slots, ...updates.slots },
    };
    await this.redis.set(
      `working_memory:${sessionId}`,
      JSON.stringify(updated),
      'EX', 24 * 60 * 60
    );
  }

  // LONG-TERM: per-user facts that persist across sessions (opt-in by tenant)
  async getLongTermMemory(identityId: string, tenantId: string): Promise<LongTermMemory | null> {
    if (!await this.isLongTermMemoryEnabled(tenantId)) return null;
    return this.longTermMemoryRepo.get(identityId, tenantId);
  }

  async upsertLongTermMemory(
    identityId: string,
    tenantId: string,
    facts: MemoryFact[],
  ): Promise<void> {
    if (!await this.isLongTermMemoryEnabled(tenantId)) return;
    const reliable = facts.filter(f => f.confidence >= 0.75);
    await this.longTermMemoryRepo.upsert(identityId, tenantId, reliable);
  }
}
```

## 6.11 Tool execution loop

```typescript
// apps/api/src/agent/tool-executor.ts

export class ToolExecutor {

  async runLoop(
    context: AgentContext,
    llmClient: LLMClient,
    tenantId: string,
    session: EndUserSession,
    conversationId: string,
  ): Promise<ToolLoopResult> {
    const messages = [...context.messages];
    const allToolResults: ToolCallRecord[] = [];
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await llmClient.complete({
        messages,
        systemPrompt: context.systemPrompt,
        tools: context.tools,
        tenantId,
        conversationId,
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          finalResponse: response.content,
          toolCallRecords: allToolResults,
          usage: { inputTokens: response.inputTokens, outputTokens: response.outputTokens },
        };
      }

      const toolResults: LLMMessage = { role: 'tool', content: [] };

      for (const toolCall of response.toolCalls) {
        const result = await this.policyLayer.executeAction({
          tenantId,
          session,
          actionKey: toolCall.name,
          args: toolCall.args,
          conversationId,
        });

        allToolResults.push({ toolCall, result });

        (toolResults.content as LLMToolResult[]).push({
          toolCallId: toolCall.id,
          content: result.success ? result.data : { error: result.error },
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push(toolResults);
    }

    // Exceeded max iterations
    return {
      finalResponse: null,
      toolCallRecords: allToolResults,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
```

## 6.12 Fallback ladder

```typescript
// apps/api/src/agent/fallback.service.ts

export class FallbackService {

  async run(input: FallbackInput, ladder: FallbackStep[]): Promise<FallbackResult> {
    const sortedSteps = ladder.sort((a, b) => a.order - b.order);
    const attempts = await this.getFallbackAttempts(input.conversationId);

    for (const step of sortedSteps) {
      const stepAttempts = attempts[step.strategy] ?? 0;
      if (stepAttempts >= step.config.maxAttempts) continue;

      await this.incrementAttempts(input.conversationId, step.strategy);

      switch (step.strategy) {
        case 'typo_correction': {
          const corrected = await this.spellCorrect(input.originalMessage);
          if (corrected !== input.originalMessage) {
            return { strategy: 'typo_correction', correctedMessage: corrected };
          }
          continue;
        }

        case 'slot_reprompt': {
          const missingSlots = await this.identifyMissingSlots(
            input.intent, input.extractedSlots
          );
          if (missingSlots.length > 0) {
            const message = this.renderTemplate(step.config.messageTemplate, {
              missing: missingSlots[0].label,
            });
            return { strategy: 'slot_reprompt', responseMessage: message };
          }
          continue;
        }

        case 'rephrase': {
          const message = this.renderTemplate(step.config.messageTemplate, {});
          return { strategy: 'rephrase', responseMessage: message };
        }

        case 'offer_options': {
          const options = await this.getAvailableActions(input.tenantId, input.userState);
          const message = this.renderTemplate(step.config.messageTemplate, {
            options: options.slice(0, 4).map(o => o.label).join(', '),
          });
          return { strategy: 'offer_options', responseMessage: message };
        }

        case 'escalate': {
          return {
            strategy: 'escalate',
            responseMessage: this.renderTemplate(step.config.messageTemplate, {}),
            shouldEscalate: true,
          };
        }
      }
    }

    // All exhausted — force escalation
    return {
      strategy: 'escalate',
      responseMessage: "I'm having trouble helping with this. Let me connect you with someone who can.",
      shouldEscalate: true,
    };
  }
}
```

## 6.13 Telemetry events

```typescript
// packages/types/src/telemetry.ts

export interface TurnTelemetryEvent {
  eventType: 'turn.completed';
  tenantId: string;
  conversationId: string;
  turnId: string;
  identityId: string;

  playbookId: string;
  playbookVersion: string;
  userState: string;
  stateChanged: boolean;

  model: string;
  provider: LLMProvider;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  llmLatencyMs: number;

  toolCallCount: number;
  toolCallResults: Array<{ actionKey: string; success: boolean; tier: number }>;

  kbChunksRetrieved: number;
  kbChunkIds: string[];

  fallbackTriggered: boolean;
  fallbackStrategy?: FallbackStrategy;

  triggersEvaluated: number;
  triggersFired: string[];

  escalated: boolean;
  channelType: ChannelType;
  totalLatencyMs: number;

  confidenceScore?: number;
  playbookIsExperiment: boolean;
}
```

## 6.14 Database schema — agent runtime tables

```typescript
// packages/db/src/schema/agent.ts

export const conversations = pgTable('conversations', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenantId:          uuid('tenant_id').notNull(),
  identityId:        uuid('identity_id').notNull(),
  status:            varchar('status', { length: 50 }).notNull().default('active'),
  activeChannelType: varchar('active_channel_type', { length: 50 }).notNull(),
  playbookId:        uuid('playbook_id').notNull(),
  playbookVersion:   varchar('playbook_version', { length: 20 }).notNull(),
  userStateAtStart:  varchar('user_state_at_start', { length: 100 }).notNull(),
  currentUserState:  varchar('current_user_state', { length: 100 }).notNull(),
  metadata:          jsonb('metadata').notNull().default('{}'),
  startedAt:         timestamp('started_at').notNull().defaultNow(),
  lastActivityAt:    timestamp('last_activity_at').notNull().defaultNow(),
  resolvedAt:        timestamp('resolved_at'),
});

export const turns = pgTable('turns', {
  id:             uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  tenantId:       uuid('tenant_id').notNull(),
  role:           varchar('role', { length: 20 }).notNull(),
  content:        jsonb('content').notNull(),
  channelType:    varchar('channel_type', { length: 50 }),
  modelUsed:      varchar('model_used', { length: 100 }),
  inputTokens:    integer('input_tokens'),
  outputTokens:   integer('output_tokens'),
  latencyMs:      integer('latency_ms'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});

export const playbooks = pgTable('playbooks', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenantId:              uuid('tenant_id').notNull(),
  version:               varchar('version', { length: 20 }).notNull(),
  status:                varchar('status', { length: 50 }).notNull().default('draft'),
  deploymentMode:        varchar('deployment_mode', { length: 50 }),
  gradualRolloutPercent: integer('gradual_rollout_percent'),
  config:                jsonb('config').notNull(),
  bootstrappedFromSpecId: uuid('bootstrapped_from_spec_id'),
  createdAt:             timestamp('created_at').notNull().defaultNow(),
  publishedAt:           timestamp('published_at'),
});

export const longTermMemory = pgTable('long_term_memory', {
  id:          uuid('id').primaryKey().defaultRandom(),
  identityId:  uuid('identity_id').notNull(),
  tenantId:    uuid('tenant_id').notNull(),
  key:         varchar('key', { length: 255 }).notNull(),
  value:       jsonb('value').notNull(),
  confidence:  real('confidence').notNull(),
  extractedAt: timestamp('extracted_at').notNull(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});
```

## 6.15 Acceptance criteria

**Given** an inbound message arrives from a verified user
**When** the agent runtime processes it
**Then** the full pipeline completes and a response is delivered within 3 seconds for text channels.

**Given** state inference classifies a user as `at_risk` with confidence 0.70
**When** the current state is `early_user`
**Then** the state is updated, the new behavior bundle loads, a transition is in the audit log.

**Given** state inference produces confidence 0.55 (below 0.65 threshold)
**When** the current state is `early_user`
**Then** the state is NOT updated.

**Given** a trigger rule `message_contains: ['cancel', 'quit']`
**When** the user sends "I want to cancel my account"
**Then** the trigger fires, the `at_risk` behavior bundle loads, and the trigger action executes.

**Given** a gradual rollout playbook at 30%
**When** 1000 conversations are processed
**Then** approximately 300 (±30) route to the new version.

**Given** the LLM requests a tool call for an action not in `behavior.allowedActionKeys`
**When** the tool executor sends it to Layer 5
**Then** Layer 5 returns permission denied, the LLM is prompted to inform the user.

**Given** the tool call loop runs 5 iterations without producing final text
**When** the 5th iteration completes
**Then** the loop exits, the fallback ladder engages, the user receives a coherent response.

**Given** the fallback ladder runs `slot_reprompt` twice and `rephrase` twice and all steps exhausted
**When** the next failure occurs
**Then** the conversation is escalated to a human agent.

**Given** RAG retrieval returns 3 chunks above relevance threshold
**When** the agent context is built
**Then** all 3 chunks appear in the context block with their source titles.

**Given** BYOK is configured for a tenant
**When** an LLM call is made
**Then** the platform's own API keys are not used — the tenant's decrypted key is sent.

## 6.16 Test cases

### Unit tests

| Test | What it verifies |
|---|---|
| State inference returns `unverified` with high confidence when `verifiedAt` is null | Context signal |
| State inference returns `at_risk` when `daysSinceLogin > 30` | Context signal |
| State inference does not update state when confidence < 0.65 | Threshold enforcement |
| `evaluateCondition('message_contains')` matches case-insensitively | Trigger condition |
| `evaluateCondition('and')` returns false if any sub-condition false | Compound trigger |
| `selectVersion` always returns same version for same conversationId | Deterministic rollout |
| `enforceTokenBudget` removes oldest when over budget | Token budget |
| `reciprocalRankFusion` combines correctly | RAG fusion |
| `FallbackService.run` exhausts `slot_reprompt` before `rephrase` | Ladder ordering |
| `FallbackService.run` forces escalation when all exhausted | Exhaustion handling |
| `ToolExecutor.runLoop` exits after MAX_ITERATIONS with null finalResponse | Loop guard |
| Working memory set/get roundtrip | Memory persistence |
| Long-term memory skips facts with confidence < 0.75 | Confidence gate |

### Integration tests

| Test | What it verifies |
|---|---|
| Full turn pipeline: inbound → state inference → playbook load → LLM call → tool call → response | Happy path |
| State transition: send 2 cancel-intent messages → state updates to `at_risk` | State machine |
| Trigger fires: configure `message_contains: cancel` → send "cancel" → action executes | Trigger E2E |
| Gradual rollout: 100 conversations → ~30 hit new playbook at 30% | Rollout logic |
| BYOK: configure tenant with OpenAI BYOK → Anthropic key not used | Key isolation |
| RAG: upload KB doc → send question → relevant chunk in context | RAG pipeline |
| Fallback: mock LLM to return 0 confidence → fallback ladder runs in order | Fallback E2E |
| Memory: send message referencing "the order" → working memory slot populated → next turn uses it | Working memory |
| Shadow playbook: deploy shadow → process 100 messages → both versions logged, only active sent to user | Shadow mode |

### Load tests

| Test | Target | Threshold |
|---|---|---|
| Concurrent turn processing | 200 simultaneous turns | P95 < 3s, P99 < 5s |
| RAG retrieval under load | 500 queries/min | P95 < 300ms |
| State inference under load | 1000 inferences/min | P95 < 200ms |

### Security tests

| Test | What it verifies |
|---|---|
| Tool call for action not in `allowedActionKeys` rejected before Layer 5 | Action scope enforcement |
| Tenant A's playbook cannot load for tenant B | Tenant isolation |
| Prompt injection in user message does not override system prompt | Injection resistance |

## 6.17 Definition of done for Layer 4

- [ ] `StateInferenceEngine`: three signal sources, threshold-gated update, audit on transition.
- [ ] `PlaybookEngine`: version selection (immediate/shadow/gradual), behavior bundle resolution, trigger eval for all condition types.
- [ ] `packages/llm`: `LLMClient` interface, Anthropic + OpenAI implementations, BYOK key resolution, streaming support.
- [ ] `AgentContextBuilder`: system prompt, RAG injection, history loading, token budget.
- [ ] `RAGRetrievalService`: hybrid retrieval, RRF fusion, reranking, relevance filter.
- [ ] `MemoryService`: short-term (DB), working memory (Redis), long-term (DB, opt-in).
- [ ] `ToolExecutor`: loop with MAX_ITERATIONS, tool result injection back to LLM.
- [ ] `FallbackService`: all 5 strategies, ladder ordered, attempt tracking.
- [ ] `TurnTelemetryEvent` emitted with all fields on every turn.
- [ ] All Postgres tables created via migrations.
- [ ] All acceptance criteria pass.
- [ ] All tests pass with ≥80% coverage.
- [ ] Load test targets met in staging.
- [ ] Security tests pass.
- [ ] Runbook: LLM provider outage (fallback), state stuck in wrong state (admin override), infinite tool loop detection.

---

# Part 7 — Layer 5: Integration & Policy

> **Build target:** `apps/api/src/integration/`, `apps/api/src/policy/`
> **Depends on:** Layer 1 (Foundations), Layer 3 (Identity & Session), Layer 4 (Playbook & Agent Runtime)
> **Consumed by:** Layer 4 (tool execution loop), Layer 6 (Admin & Config)

This is the capability moat. Spec ingestion, action definitions, the four-tier safety model, the auth proxy, action execution, and playbook bootstrap all live here. Every tool call from Layer 4 passes through this layer before any external SaaS API is touched.

## 7.1 Goals

- Ingest API specs in multiple formats (OpenAPI 3.x, OpenAPI 2 / Swagger, Postman, GraphQL, MCP, raw docs) and normalize them into a unified internal action definition model.
- Give SaaS admins a policy editor where they assign risk tiers, confirmation copy, permission scopes, and constraints to each exposed action.
- Execute actions on behalf of verified end users via an auth proxy — using the user's own scoped token, never a master key.
- Enforce the four-tier safety model at runtime: every action call from Layer 4 passes through this layer before any external API is touched.
- Bootstrap a draft playbook from the ingested spec — infer lifecycle states, map actions to states, generate fallback ladder defaults — so tenants start with a working configuration rather than a blank slate.
- Maintain a complete, immutable audit record of every action invocation.

## 7.2 Non-goals

- Does not decide which actions the LLM should call. That is Layer 4.
- Does not manage conversation state or memory. That is Layer 4.
- Does not handle channel delivery. That is Layer 2.
- Does not build the admin UI for the policy editor. That is Layer 6.

## 7.3 Core concepts

### The Action Definition

An `ActionDefinition` is the normalized, policy-enriched representation of a single API endpoint. It is what Layer 4 sees when it builds the tool list for the LLM. It is what Layer 5 uses to enforce safety when the LLM calls it. It differs from the raw API spec entry because it has been enriched with admin-configured policy (tier, confirmation copy, permission scope, constraints) and translated into an LLM-friendly tool description.

### The Auth Proxy

The platform never calls the SaaS API using a master API key. Every outbound call uses a per-user scoped token obtained during identity verification (Layer 3). This means the SaaS company's audit trail shows actions taken by specific users, not by "the AI platform". A compromised platform credential cannot be used to act on behalf of all users. Per-user permission scopes from the SaaS system are enforced at the API level.

### The Four-Tier Safety Model

- **Tier 0 — Read.** No confirmation. Executes immediately. (Get account status, list invoices, search KB.)
- **Tier 1 — Reversible Write.** Inline confirmation in chat before execution. (Schedule meeting, create draft, send notification.)
- **Tier 2 — State Update.** Explicit before/after summary shown to user. User must confirm. (Update billing address, change subscription plan.)
- **Tier 3 — Destructive or Financial.** Step-up authentication required. Multi-step confirmation. Immutable audit log. (Cancel subscription, delete account, issue refund.)

## 7.4 Spec ingestion

### 7.4.1 Supported formats and types

```typescript
// packages/types/src/spec.ts

export enum SpecFormat {
  OpenAPI3 = 'openapi_3',
  OpenAPI2 = 'openapi_2',
  Postman  = 'postman',
  GraphQL  = 'graphql',
  MCP      = 'mcp',
  RawDocs  = 'raw_docs',
}

export interface SpecIngestionRequest {
  tenantId: string;
  format: SpecFormat;
  content?: string;    // Raw YAML/JSON content
  url?: string;        // URL to fetch (MCP server, raw docs URL, hosted OpenAPI)
  file?: Buffer;       // Uploaded file
}

export interface IngestionResult {
  specId: string;
  format: SpecFormat;
  rawActionCount: number;
  parsedActions: ParsedAction[];
  warnings: string[];
  errors: string[];
}

export interface ParsedAction {
  key: string;             // 'get_account_status', 'create_invoice'
  httpMethod?: string;     // null for GraphQL/MCP
  path?: string;           // null for GraphQL/MCP
  summary: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  suggestedTier: ActionTier;
  tags: string[];
}
```

### 7.4.2 Ingestion pipeline

```typescript
// apps/api/src/integration/spec-ingestion.service.ts

export class SpecIngestionService {
  async ingest(req: SpecIngestionRequest): Promise<IngestionResult> {
    const raw = await this.fetchRawContent(req);
    const parsed = await this.parse(req.format, raw);
    const enriched = await this.enrichDescriptions(parsed, req.tenantId);
    const withTiers = this.inferTiers(enriched);

    const specId = await this.specRepo.save({
      tenantId: req.tenantId,
      format: req.format,
      rawContent: raw,
      parsedActions: withTiers,
    });

    // Trigger bootstrap async — does not block ingestion response
    await this.bootstrapQueue.add('bootstrap_playbook', { tenantId: req.tenantId, specId });

    return { specId, format: req.format, rawActionCount: withTiers.length, parsedActions: withTiers, warnings: parsed.warnings, errors: parsed.errors };
  }

  private suggestTier(action: ParsedAction): ActionTier {
    const method = action.httpMethod?.toUpperCase();
    const key = action.key.toLowerCase();

    const destructivePatterns = ['delete', 'cancel', 'terminate', 'remove', 'purge', 'refund', 'transfer'];
    if (destructivePatterns.some(p => key.includes(p))) return ActionTier.Destructive;

    const financialPatterns = ['payment', 'charge', 'invoice', 'billing', 'subscription'];
    if (method === 'POST' && financialPatterns.some(p => key.includes(p))) return ActionTier.Destructive;

    if (method === 'PUT' || method === 'PATCH') return ActionTier.StateUpdate;
    if (method === 'POST') return ActionTier.ReversibleWrite;
    if (method === 'GET') return ActionTier.Read;

    return ActionTier.ReversibleWrite;  // Default — admin can lower
  }

  // LLM-assisted description enrichment for thin or missing spec descriptions
  private async enrichDescriptions(actions: ParsedAction[], tenantId: string): Promise<ParsedAction[]> {
    const needsEnrichment = actions.filter(a => !a.description || a.description.length < 20);
    if (needsEnrichment.length === 0) return actions;

    const enriched = await this.llm.complete({
      tenantId,
      conversationId: 'spec-ingestion',
      systemPrompt: `You are helping document API endpoints for a SaaS product.
For each endpoint, write a clear, user-facing description.
Return a JSON object mapping action key to description. Nothing else.`,
      messages: [{
        role: 'user',
        content: JSON.stringify(needsEnrichment.map(a => ({ key: a.key, method: a.httpMethod, path: a.path, summary: a.summary }))),
      }],
      maxTokens: 2000,
    });

    const descriptions = JSON.parse(enriched.content) as Record<string, string>;
    return actions.map(a => ({ ...a, description: descriptions[a.key] ?? a.description }));
  }
}
```

### 7.4.3 Format-specific parsers

Each parser lives in `apps/api/src/integration/parsers/`:

- **`openapi.parser.ts`** — Parses OpenAPI 3.x. Handles path parameters, query params, request body, response schemas, `$ref` resolution, `allOf`/`anyOf`/`oneOf` schemas, security schemes.
- **`postman.parser.ts`** — Parses Postman Collection v2.1. Folder grouping becomes tags. Pre-request scripts ignored. Example requests used to infer schemas.
- **`graphql.parser.ts`** — Parses GraphQL SDL. Queries → Tier 0. Mutations → Tier 1/2/3 by naming. Subscriptions not supported V1.
- **`mcp.parser.ts`** — Fetches tool definitions from an MCP server URL. Minimal enrichment needed since MCP tools already have descriptions and schemas.
- **`raw-docs.parser.ts`** — Accepts URL or pasted text. Uses LLM to extract endpoint signatures. Lower fidelity — always flags warnings. Admin must review all parsed actions before publishing.

## 7.5 Action Definition model

```typescript
// packages/types/src/action.ts

export enum ActionTier {
  Read            = 0,
  ReversibleWrite = 1,
  StateUpdate     = 2,
  Destructive     = 3,
}

export interface ActionDefinition {
  id: string;
  tenantId: string;
  specId: string;
  key: string;
  label: string;
  description: string;

  // HTTP binding (null for GraphQL/MCP)
  httpMethod?: string;
  path?: string;
  baseUrl: string;

  // Input schema — what the LLM must provide
  inputSchema: JSONSchema;

  // Policy (admin-configured)
  exposed: boolean;
  tier: ActionTier;
  requiredPermissions: string[];
  confirmationCopy?: string;       // "You are changing your plan to {plan_name}. Confirm?"
  beforeAfterTemplate?: string;
  stepUpRequired: boolean;
  rateLimitPerUserPerHour: number; // 0 = no limit
  argConstraints: ArgConstraint[];
  preConditions: PreCondition[];

  // Post-execution
  postActionMessage: string;       // "Done. Your plan has been updated to {plan_name}. Confirmation: {id}"
  auditFields: string[];

  createdAt: Date;
  updatedAt: Date;
}

export type ArgConstraint =
  | { type: 'max_value'; field: string; max: number }
  | { type: 'min_value'; field: string; min: number }
  | { type: 'allowed_values'; field: string; values: string[] }
  | { type: 'regex'; field: string; pattern: string }
  | { type: 'not_equal'; field: string; value: unknown };

export type PreCondition =
  | { type: 'user_context_field'; field: string; operator: '==' | '!=' | '>' | '<'; value: unknown }
  | { type: 'session_step_up_valid' }
  | { type: 'no_pending_action'; actionKey: string };
```

## 7.6 Policy enforcement — the runtime safety gate

Every tool call from Layer 4 passes through this gate before any external API is hit. This is the most security-critical code path in the platform.

```typescript
// apps/api/src/integration/policy.service.ts

export interface ActionExecutionRequest {
  tenantId: string;
  session: EndUserSession;
  actionKey: string;
  args: Record<string, unknown>;
  conversationId: string;
  turnId: string;
}

export interface ActionExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: ConfirmationRequest;
  requiresStepUp?: boolean;
  auditEventId: string;
}

export interface ConfirmationRequest {
  message: string;
  actionKey: string;
  confirmedArgs: Record<string, unknown>;  // Args locked at confirmation — prevents TOCTOU
  expiresAt: Date;
  token: string;
}

export class PolicyService {
  async executeAction(req: ActionExecutionRequest): Promise<ActionExecutionResult> {
    const auditEventId = ulid();
    const log = createLogger({ tenantId: req.tenantId, conversationId: req.conversationId });

    // ── GATE 1: Load and validate action ──
    const action = await this.actionRepo.getByKey(req.tenantId, req.actionKey);
    if (!action) {
      await this.audit(auditEventId, req, 'action.not_found', { actionKey: req.actionKey });
      throw Errors.notFound('ActionDefinition', req.actionKey);
    }
    if (!action.exposed) {
      await this.audit(auditEventId, req, 'action.not_exposed', { actionKey: req.actionKey });
      throw Errors.forbidden(`Action '${req.actionKey}' is not exposed to end users.`);
    }

    // ── GATE 2: Permission check ──
    if (action.requiredPermissions.length > 0) {
      const userPermissions = await this.getEndUserPermissions(req.session, req.tenantId);
      const hasPermission = action.requiredPermissions.every(p => userPermissions.includes(p));
      if (!hasPermission) {
        await this.audit(auditEventId, req, 'action.permission_denied', { required: action.requiredPermissions, actual: userPermissions });
        throw Errors.forbidden(`Insufficient permissions for action '${req.actionKey}'.`);
      }
    }

    // ── GATE 3: Argument validation ──
    const schemaErrors = this.validateSchema(req.args, action.inputSchema);
    if (schemaErrors.length > 0) {
      await this.audit(auditEventId, req, 'action.validation_failed', { errors: schemaErrors });
      throw Errors.validation({ errors: schemaErrors });
    }
    const constraintErrors = this.validateConstraints(req.args, action.argConstraints);
    if (constraintErrors.length > 0) {
      await this.audit(auditEventId, req, 'action.constraint_violated', { errors: constraintErrors });
      throw Errors.validation({ errors: constraintErrors });
    }

    // ── GATE 4: Pre-conditions ──
    const preConditionResult = await this.checkPreConditions(action.preConditions, req.session, req.tenantId, req.args);
    if (!preConditionResult.passed) {
      await this.audit(auditEventId, req, 'action.precondition_failed', { failed: preConditionResult.failedCondition });
      throw Errors.forbidden(`Pre-condition not met: ${preConditionResult.failedCondition}`);
    }

    // ── GATE 5: Rate limit ──
    if (action.rateLimitPerUserPerHour > 0) {
      const key = `ratelimit:action:${req.tenantId}:${req.session.identityId}:${req.actionKey}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 3600);
      if (count > action.rateLimitPerUserPerHour) {
        await this.audit(auditEventId, req, 'action.rate_limited', { count, limit: action.rateLimitPerUserPerHour });
        throw Errors.rateLimited(3600 * 1000);
      }
    }

    // ── GATE 6: Tier-based confirmation ──
    if (action.tier >= ActionTier.ReversibleWrite) {
      const pendingConfirmation = await this.getPendingConfirmation(req.tenantId, req.conversationId, req.actionKey);

      if (!pendingConfirmation) {
        // First time through — generate confirmation request, do NOT execute
        const confirmationCopy = this.renderTemplate(action.confirmationCopy!, req.args);
        const token = this.signConfirmationToken(req.tenantId, req.actionKey, req.args);

        await this.storePendingConfirmation(token, {
          tenantId: req.tenantId,
          conversationId: req.conversationId,
          actionKey: req.actionKey,
          confirmedArgs: req.args,    // Lock args at confirmation time
          expiresAt: addMinutes(new Date(), 5),
        });

        await this.audit(auditEventId, req, 'action.confirmation_requested', { tier: action.tier, actionKey: req.actionKey });

        return {
          success: false,
          requiresConfirmation: { message: confirmationCopy, actionKey: req.actionKey, confirmedArgs: req.args, expiresAt: addMinutes(new Date(), 5), token },
          auditEventId,
        };
      }

      // User confirmed — consume token and use locked args
      await this.consumePendingConfirmation(pendingConfirmation.token);
      req = { ...req, args: pendingConfirmation.confirmedArgs };  // TOCTOU protection
    }

    // ── GATE 7: Step-up for Tier 3 ──
    if (action.tier === ActionTier.Destructive || action.stepUpRequired) {
      if (!this.sessionService.isStepUpValid(req.session)) {
        await this.sessionService.initiateStepUp(req.session.id, req.tenantId, req.session.identityId);
        await this.audit(auditEventId, req, 'action.step_up_required', { actionKey: req.actionKey });
        return { success: false, requiresStepUp: true, auditEventId };
      }
    }

    // ── EXECUTE ──
    await this.audit(auditEventId, req, 'action.invoked', {
      actionKey: req.actionKey,
      tier: action.tier,
      args: this.redactPII(req.args, action.auditFields),
    });

    let result: unknown;
    let success: boolean;
    let errorMessage: string | undefined;

    try {
      result = await this.authProxy.call(req.tenantId, req.session, action, req.args);
      success = true;
      await this.audit(auditEventId, req, 'action.succeeded', {
        actionKey: req.actionKey,
        responseFields: this.extractAuditFields(result, action.auditFields),
      });
    } catch (err) {
      success = false;
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await this.audit(auditEventId, req, 'action.failed', { actionKey: req.actionKey, error: errorMessage });
    }

    return { success, data: result, error: errorMessage, auditEventId };
  }

  private renderTemplate(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => String(args[key] ?? `{${key}}`));
  }
}
```

## 7.7 Auth proxy

```typescript
// apps/api/src/integration/auth-proxy.service.ts

export class AuthProxyService {
  async call(tenantId: string, session: EndUserSession, action: ActionDefinition, args: Record<string, unknown>): Promise<unknown> {
    // 1. Retrieve and decrypt the user's access token
    const identity = await this.identityRepo.get(session.identityId);
    if (!identity.encryptedAccessToken) {
      throw Errors.unauthorized('No access token on file for this user. Re-verification required.');
    }
    const accessToken = await decrypt(JSON.parse(identity.encryptedAccessToken));

    // 2. Refresh if about to expire
    if (identity.tokenExpiresAt && identity.tokenExpiresAt < addMinutes(new Date(), 5)) {
      const refreshed = await this.refreshToken(tenantId, accessToken);
      await this.identityRepo.storeAccessToken(identity.id, await encrypt(refreshed.accessToken), refreshed.expiresAt);
    }

    // 3. Build the outbound HTTP request
    const request = this.buildRequest(action, args, accessToken);

    // 4. Execute with timeout and retry (5xx only, never 4xx)
    const response = await this.httpClient.execute(request, {
      timeoutMs: 10_000,
      retries: 2,
      retryOn: [502, 503, 504],
    });

    if (!response.ok) {
      const body = await response.text();
      throw new AppError(
        ErrorCode.SaaSAPIError,
        `SaaS API returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
        { actionKey: action.key, status: response.status },
        true,
      );
    }

    return response.json();
  }

  private buildRequest(action: ActionDefinition, args: Record<string, unknown>, accessToken: string): HttpRequest {
    let path = action.path ?? '';
    const pathParams: Record<string, unknown> = {};
    const queryParams: Record<string, unknown> = {};
    let body: Record<string, unknown> | undefined;

    // Route args into path/query/body based on schema
    for (const [key, value] of Object.entries(args)) {
      if (path.includes(`{${key}}`)) {
        pathParams[key] = value;
      } else if (action.httpMethod === 'GET' || action.httpMethod === 'DELETE') {
        queryParams[key] = value;
      } else {
        body = body ?? {};
        body[key] = value;
      }
    }

    for (const [key, value] of Object.entries(pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }

    const url = new URL(path, action.baseUrl);
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, String(value));
    }

    return {
      method: action.httpMethod ?? 'POST',
      url: url.toString(),
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Platform-Request-Id': ulid(),
      },
      body: body ? JSON.stringify(body) : undefined,
    };
  }
}
```

## 7.8 Playbook bootstrap

When a spec is ingested, the platform automatically generates a draft playbook. Admins review and edit — they never start from blank.

```typescript
// apps/api/src/integration/playbook-bootstrap.service.ts

export class PlaybookBootstrapService {
  async bootstrap(tenantId: string, specId: string): Promise<BootstrapResult> {
    const spec = await this.specRepo.get(specId);
    const actions = spec.parsedActions;
    const prompt = this.buildBootstrapPrompt(actions);

    const response = await this.llm.complete({
      tenantId,
      conversationId: 'playbook-bootstrap',
      systemPrompt: `You are an expert in SaaS product design and customer lifecycle management.
Analyze a set of API actions and generate a structured playbook configuration.
Return only valid JSON matching the schema provided. No explanation, no markdown.`,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
    });

    let draft: PlaybookDraft;
    try {
      draft = JSON.parse(response.content);
    } catch {
      throw new AppError(ErrorCode.InternalError, 'Failed to parse LLM-generated playbook draft', 500);
    }

    const validated = this.validateDraft(draft, actions);

    const playbook = await this.playbookRepo.create({
      tenantId,
      version: '1.0.0',
      status: PlaybookStatus.Draft,
      config: validated,
      bootstrappedFromSpecId: specId,
    });

    return { playbookId: playbook.id, draft: validated, warnings: validated.warnings };
  }

  private buildBootstrapPrompt(actions: ParsedAction[]): string {
    const actionSummary = actions.map(a =>
      `- ${a.key} (${a.httpMethod ?? 'operation'}) [Tier ${a.suggestedTier}]: ${a.description}`
    ).join('\n');

    return `
Analyze these API actions from a SaaS product and generate a playbook configuration.

ACTIONS:
${actionSummary}

Generate a JSON object with this structure:
{
  "lifecycle": {
    "states": [{
      "key": "snake_case_state_key",
      "label": "Human Readable Label",
      "description": "When is a user in this state?",
      "inferenceHints": ["signal 1", "signal 2"],
      "behavior": {
        "persona": "How the bot should behave",
        "toneGuidelines": ["guideline 1"],
        "openingBehavior": "full_intro | brief_greeting | skip_to_intent | retention_mode",
        "allowedActionKeys": ["action_key_1"],
        "kbScopeIds": [],
        "skillPacks": [],
        "confidenceFloor": 0.6,
        "requireConfirmationForTier": 1
      }
    }],
    "defaultState": "verified"
  },
  "triggers": [{
    "id": "trigger_1",
    "label": "Human readable trigger name",
    "enabled": true,
    "event": { "type": "message_received" },
    "condition": { "type": "message_contains", "phrases": ["cancel"], "matchType": "any" },
    "action": { "type": "transition_state", "targetState": "at_risk" }
  }],
  "fallbackLadder": [
    { "order": 1, "strategy": "slot_reprompt", "config": { "maxAttempts": 2, "messageTemplate": "Could you clarify {missing}?" }},
    { "order": 2, "strategy": "rephrase", "config": { "maxAttempts": 1, "messageTemplate": "Let me try asking differently." }},
    { "order": 3, "strategy": "offer_options", "config": { "maxAttempts": 1, "messageTemplate": "Here is what I can help with: {options}" }},
    { "order": 4, "strategy": "escalate", "config": { "maxAttempts": 1, "messageTemplate": "Let me connect you with someone who can help." }}
  ]
}

Infer 4–7 lifecycle states appropriate for this type of SaaS product.
Typical: unverified, onboarding, active, power_user, at_risk, churning.
For allowedActionKeys: unverified → read-only or none; power users → advanced actions;
at-risk/churning → retention-focused actions.
`;
  }
}
```

## 7.9 Action tool generation for LLM

```typescript
// apps/api/src/integration/tool-generator.service.ts

export class ToolGeneratorService {
  async getToolsForState(tenantId: string, allowedActionKeys: string[]): Promise<LLMTool[]> {
    if (allowedActionKeys[0] === '*') {
      const all = await this.actionRepo.getAllExposed(tenantId);
      return all.map(this.actionToTool);
    }
    const actions = await this.actionRepo.getByKeys(tenantId, allowedActionKeys);
    return actions.filter(a => a.exposed).map(this.actionToTool);
  }

  private actionToTool(action: ActionDefinition): LLMTool {
    return {
      name: action.key,
      description: this.buildToolDescription(action),
      inputSchema: action.inputSchema,
    };
  }

  private buildToolDescription(action: ActionDefinition): string {
    let desc = action.description;
    switch (action.tier) {
      case ActionTier.Read: break;
      case ActionTier.ReversibleWrite:
        desc += '\n\nNote: This action will ask the user for confirmation before executing.'; break;
      case ActionTier.StateUpdate:
        desc += '\n\nNote: This action modifies account state and will show the user a summary before executing.'; break;
      case ActionTier.Destructive:
        desc += '\n\nNote: This is a sensitive action. The user must re-verify their identity before it executes.'; break;
    }
    if (action.rateLimitPerUserPerHour > 0) {
      desc += ` (Rate limited to ${action.rateLimitPerUserPerHour} uses per hour.)`;
    }
    return desc;
  }
}
```

## 7.10 Database schema

```typescript
// packages/db/src/schema/integration.ts

export const apiSpecs = pgTable('api_specs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenantId:      uuid('tenant_id').notNull().references(() => tenants.id),
  format:        varchar('format', { length: 50 }).notNull(),
  rawContent:    text('raw_content').notNull(),
  parsedActions: jsonb('parsed_actions').notNull(),
  warnings:      jsonb('warnings').notNull().default('[]'),
  createdAt:     timestamp('created_at').notNull().defaultNow(),
});

export const actionDefinitions = pgTable('action_definitions', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenantId:                uuid('tenant_id').notNull().references(() => tenants.id),
  specId:                  uuid('spec_id').notNull().references(() => apiSpecs.id),
  key:                     varchar('key', { length: 255 }).notNull(),
  label:                   varchar('label', { length: 255 }).notNull(),
  description:             text('description').notNull(),
  httpMethod:              varchar('http_method', { length: 10 }),
  path:                    varchar('path', { length: 500 }),
  baseUrl:                 varchar('base_url', { length: 500 }).notNull(),
  inputSchema:             jsonb('input_schema').notNull(),
  outputSchema:            jsonb('output_schema'),
  exposed:                 boolean('exposed').notNull().default(false),
  tier:                    integer('tier').notNull().default(0),
  requiredPermissions:     jsonb('required_permissions').notNull().default('[]'),
  confirmationCopy:        text('confirmation_copy'),
  beforeAfterTemplate:     text('before_after_template'),
  stepUpRequired:          boolean('step_up_required').notNull().default(false),
  rateLimitPerUserPerHour: integer('rate_limit_per_user_per_hour').notNull().default(0),
  argConstraints:          jsonb('arg_constraints').notNull().default('[]'),
  preConditions:           jsonb('pre_conditions').notNull().default('[]'),
  postActionMessage:       text('post_action_message').notNull().default('Done.'),
  auditFields:             jsonb('audit_fields').notNull().default('[]'),
  createdAt:               timestamp('created_at').notNull().defaultNow(),
  updatedAt:               timestamp('updated_at').notNull().defaultNow(),
});
// Unique index: (tenant_id, key)
// Index: (tenant_id, exposed)

// Immutable — no UPDATE or DELETE
export const actionInvocations = pgTable('action_invocations', {
  id:             uuid('id').primaryKey(),    // auditEventId from PolicyService
  tenantId:       uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  identityId:     uuid('identity_id').notNull(),
  actionKey:      varchar('action_key', { length: 255 }).notNull(),
  tier:           integer('tier').notNull(),
  status:         varchar('status', { length: 50 }).notNull(),
  argsRedacted:   jsonb('args_redacted'),
  responseFields: jsonb('response_fields'),
  errorMessage:   text('error_message'),
  latencyMs:      integer('latency_ms'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});
// Index: (tenant_id, conversation_id), (tenant_id, action_key, created_at)

export const pendingConfirmations = pgTable('pending_confirmations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  token:          text('token').notNull().unique(),
  tenantId:       uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  actionKey:      varchar('action_key', { length: 255 }).notNull(),
  confirmedArgs:  jsonb('confirmed_args').notNull(),
  expiresAt:      timestamp('expires_at').notNull(),
  consumedAt:     timestamp('consumed_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});
```

## 7.11 API endpoints

```
# Spec ingestion
POST   /api/v1/specs                       Ingest a new spec (upload file or provide URL/content)
GET    /api/v1/specs                       List ingested specs
GET    /api/v1/specs/:id                   Get spec details + parsed actions
DELETE /api/v1/specs/:id                   Remove a spec (only if no active actions reference it)

# Action definitions
GET    /api/v1/actions                     List all (paginated, filterable)
GET    /api/v1/actions/:id                 Get a single action definition
PATCH  /api/v1/actions/:id                 Update policy config
POST   /api/v1/actions/:id/test            Test-call with provided args (sandbox)
POST   /api/v1/actions/bulk-expose         Expose/hide multiple at once
GET    /api/v1/actions/:id/invocations     Invocation history

# Playbook bootstrap
POST   /api/v1/specs/:id/bootstrap         Trigger bootstrap
GET    /api/v1/specs/:id/bootstrap/status  Check job status
```

## 7.12 Acceptance criteria

**Given** an OpenAPI 3.x spec is uploaded
**When** ingestion runs
**Then** all operations become `ParsedAction` records, tier suggestions applied by method/naming, LLM-enriched descriptions generated for thin entries.

**Given** a spec contains `DELETE /users/{userId}`
**When** tier inference runs
**Then** the suggested tier is `Destructive` (Tier 3).

**Given** a spec is ingested successfully
**When** the bootstrap job runs
**Then** a draft playbook is created with at least 4 lifecycle states each with non-empty `allowedActionKeys`, status `draft`.

**Given** Layer 4 calls `executeAction` for an action not in current state's `allowedActionKeys`
**When** the policy gate runs
**Then** `FORBIDDEN` is returned before any external API call.

**Given** a Tier 1 action is invoked for the first time
**When** the policy gate evaluates
**Then** a `ConfirmationRequest` is returned — action NOT executed — confirmation token stored in Redis with 5-min TTL.

**Given** the user confirms a Tier 1 action
**When** the confirmed args are submitted
**Then** the action executes using args locked at confirmation time, not any new args (TOCTOU protection).

**Given** a Tier 3 action is invoked and step-up not completed
**When** the policy gate evaluates
**Then** a step-up link is sent and the action is not executed.

**Given** a Tier 3 action is invoked and step-up was completed 20 min ago (expired)
**When** the policy gate evaluates
**Then** a new step-up is required even though the base session is still valid.

**Given** an arg constraint `max_value: amount <= 500`
**When** the LLM calls with `amount: 1000`
**Then** action rejected with validation error before any API call.

**Given** a rate limit of 5 per hour
**When** a user invokes 6 times within an hour
**Then** 6th returns `RATE_LIMIT_EXCEEDED` with `retryAfterMs`.

**Given** SaaS API returns 500
**When** auth proxy calls it
**Then** retries up to 2 times, logs each, returns `SAAS_API_ERROR` after retries exhausted.

**Given** SaaS API returns 401
**When** auth proxy calls it
**Then** does NOT retry (4xx not retried), invalidates cached access token, returns error prompting re-verification.

## 7.13 Test cases

### Unit tests

| Test | What it verifies |
|---|---|
| Tier inference: `DELETE /accounts/{id}` → Tier 3 | Destructive pattern |
| Tier inference: `POST /notifications/send` → Tier 1 | Create pattern |
| Tier inference: `GET /invoices` → Tier 0 | Read pattern |
| Tier inference: `PATCH /profile` → Tier 2 | State update pattern |
| `renderTemplate` fills `{plan_name}` from args | Template rendering |
| `renderTemplate` leaves unfilled variables as `{plan_name}` when missing | Graceful missing |
| `buildRequest` puts GET params in query string | Request construction |
| `buildRequest` resolves path params from args | Path param injection |
| `validateConstraints` rejects amount > max_value | Constraint enforcement |
| Confirmation token is signed and verifiable | Token integrity |

### Integration tests

| Test | What it verifies |
|---|---|
| Upload OpenAPI YAML → all operations parsed and stored | Ingestion pipeline |
| Upload Postman collection → operations parsed with folder tags | Postman parser |
| Ingest MCP server URL → tool definitions fetched | MCP parser |
| Policy gate: call unexposed action → FORBIDDEN before HTTP | Gate 1 |
| Policy gate: wrong user permission → FORBIDDEN | Gate 2 |
| Policy gate: invalid args → VALIDATION_ERROR | Gate 3 |
| Tier 1 first call → ConfirmationRequest, action not called | Tier 1 gate |
| Tier 1 confirmed → action executed with locked args | Tier 1 confirmation |
| Tier 3 without step-up → step-up initiated, action not called | Tier 3 gate |
| Tier 3 with valid step-up → action executed | Tier 3 execution |
| Rate limit: 6th call within hour → RATE_LIMIT_EXCEEDED | Rate limit gate |
| SaaS API 500 → retry 2x → SAAS_API_ERROR | Retry logic |
| SaaS API 401 → no retry → token invalidated | No retry on 4xx |
| All invocations (success and failure) written to action_invocations | Audit completeness |
| Bootstrap: ingest → wait → draft playbook created with valid states | Bootstrap E2E |

### Security tests

| Test | What it verifies |
|---|---|
| Confirmation args cannot be tampered between confirmation and execution | TOCTOU prevention |
| Expired confirmation token (>5 min) rejected | Confirmation TTL |
| Step-up token from different tenant rejected | Tenant isolation |
| Auth proxy never uses platform master key when BYOK configured | Key isolation |
| Tenant A cannot execute actions for tenant B's users | Cross-tenant isolation |
| `auditFields` redaction: PII fields not present in args_redacted | PII audit redaction |

## 7.14 Definition of done for Layer 5

- [ ] `SpecIngestionService`: OpenAPI 3.x, Postman, GraphQL, MCP, raw docs parsers all implemented.
- [ ] LLM-assisted description enrichment for thin entries.
- [ ] Tier inference from method + naming patterns.
- [ ] `ActionDefinition` model fully implemented with all policy fields.
- [ ] `PolicyService`: all 7 gates in order (load, permission, schema, constraints, pre-conditions, rate limit, tier confirmation, step-up).
- [ ] TOCTOU protection: args locked at confirmation, locked args used for execution.
- [ ] `AuthProxyService`: path/query/body routing, Bearer auth, retry on 5xx only, token refresh.
- [ ] `PlaybookBootstrapService`: async job, LLM prompt, schema validation, saved as draft.
- [ ] `ToolGeneratorService`: converts `ActionDefinition` to `LLMTool` with tier-aware descriptions.
- [ ] All Postgres tables created via migrations. `action_invocations` immutable.
- [ ] All API endpoints implemented.
- [ ] All acceptance criteria pass.
- [ ] All tests pass with ≥80% coverage.
- [ ] Runbook: SaaS API key rotation, action invocation spike (rate limit breach), bootstrap job failure.

---

# Part 8 — Layer 6: Admin & Config Surface

> **Build target:** `apps/admin/` (Next.js 15 App Router), `apps/api/src/admin/` (REST endpoints)
> **Depends on:** All previous layers
> **This is the customer-facing product surface. Quality here is what tenants judge the platform by.**

## 8.1 Goals

- Give SaaS admins a self-serve surface to go from zero to a live bot without engineering help.
- Make the playbook editor the primary differentiator in the admin UI — it should feel like a purpose-built tool, not a generic form builder.
- Surface enough analytics that admins can measure deflection, spot failures, and iterate confidently.
- Provide a thin but functional agent inbox for human handoff in V1.
- Give the eval harness enough UI to let admins run scenario tests and compare playbook versions before promoting.
- Never block an admin from doing something because a CSM isn't available — the product must be fully operable without us.

## 8.2 Non-goals

- Not a full helpdesk. The inbox is thin — no SLA management, no ticket routing rules, no agent performance metrics. Those are V2.
- Not a visual workflow builder. Multi-step cross-API workflows are V2.
- Not a customer data platform. We show user context from the SaaS API but we don't warehouse it.

## 8.3 Tech stack (admin frontend)

- **Framework:** Next.js 15 App Router
- **Styling:** Tailwind CSS + shadcn/ui component library
- **State management:** Zustand for client state, TanStack Query for server state + caching
- **Forms:** React Hook Form + Zod for validation
- **Rich text / code editing:** CodeMirror 6 (for JSON schema editing, raw spec viewing)
- **Drag and drop:** dnd-kit (playbook state ordering, fallback ladder reordering)
- **Charts:** Recharts
- **WebSocket (inbox):** native browser WebSocket with reconnect logic
- **Auth:** Clerk for admin authentication (email/password + SSO for Enterprise tier)

## 8.4 Application structure

```
apps/admin/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── invite/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx                      # Home — summary cards
│   │   ├── onboarding/page.tsx           # Onboarding wizard
│   │   ├── playbook/
│   │   │   ├── page.tsx                  # Playbook list + version history
│   │   │   ├── [id]/
│   │   │   │   ├── page.tsx              # Playbook editor (main)
│   │   │   │   ├── states/[stateKey]/    # Per-state behavior editor
│   │   │   │   ├── triggers/             # Trigger rule builder
│   │   │   │   └── fallback/             # Fallback ladder editor
│   │   │   └── deploy/                   # Deployment selector + rollout
│   │   ├── actions/
│   │   │   ├── page.tsx                  # Action list
│   │   │   └── [id]/page.tsx             # Action policy editor
│   │   ├── integrations/
│   │   │   ├── page.tsx                  # Spec list + ingest
│   │   │   └── [specId]/page.tsx         # Parsed actions review
│   │   ├── knowledge/
│   │   │   ├── page.tsx                  # KB collections list
│   │   │   └── [collectionId]/page.tsx   # Collection detail
│   │   ├── channels/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── inbox/
│   │   │   ├── page.tsx
│   │   │   └── [conversationId]/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── evals/
│   │   │   ├── page.tsx
│   │   │   └── [suiteId]/page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── team/
│   │       ├── billing/
│   │       ├── llm/                      # BYOK config
│   │       └── compliance/
├── components/
│   ├── ui/                               # shadcn/ui base components
│   ├── playbook/                         # Playbook-specific components
│   ├── inbox/                            # Inbox-specific components
│   ├── charts/                           # Recharts wrappers
│   └── shared/                           # Layout, nav, modals
├── lib/
│   ├── api.ts                            # Typed API client
│   ├── queries.ts                        # TanStack Query definitions
│   └── utils.ts
```

## 8.5 Onboarding wizard

The onboarding wizard is the most important flow in the product. A new tenant completes it to go from signup to a live bot. It must be completable in under 30 minutes for a technical admin.

### Steps

```
Step 1: Connect your API
  └─ Upload spec (drag-and-drop OpenAPI/Postman file, paste URL, or enter raw text)
  └─ Format auto-detected, ingestion runs, parsed action count shown
  └─ Warnings surfaced inline (e.g. "12 endpoints had no descriptions — we've generated them")
  └─ CTA: "Review actions →"

Step 2: Review and configure actions
  └─ Table of all parsed actions with suggested tier badges
  └─ Bulk actions: expose all, hide all, set all GET to Tier 0
  └─ Per-row: toggle exposed, change tier, edit description
  └─ Inline tier explainer — hover on tier badge shows what it means
  └─ Must expose at least 1 action to proceed
  └─ CTA: "Set up user identity →"

Step 3: Configure user identity
  └─ Map the "user context" endpoint: select from action list or enter manually
  └─ Map response fields: externalUserId, displayName, email, plan, lastLoginAt
  └─ Test call: enter a test user ID, see the context response live
  └─ Configure magic link copy (tenant name auto-filled, preview shown)
  └─ CTA: "Connect a channel →"

Step 4: Connect your first channel
  └─ Channel type selector (WhatsApp, Voice, Web, SMS, Slack, Teams)
  └─ Channel-specific OAuth or credential form
  └─ For WhatsApp: guide through Meta WABA setup with screenshots
  └─ Verify connection with a test message
  └─ CTA: "Review your playbook →"

Step 5: Review your playbook (bootstrap result)
  └─ Show the auto-generated draft playbook
  └─ State list with descriptions — admin can rename, merge, delete states
  └─ Quick preview of behavior bundle per state (read-only at this step)
  └─ "Edit in detail →" links into the full playbook editor
  └─ CTA: "Test your bot →"

Step 6: Test your bot
  └─ Embedded chat widget — talk to the bot as an end user
  └─ Bot uses the draft playbook, draft actions (not live yet)
  └─ Sidebar: show which state was inferred, which actions were called, confidence scores
  └─ CTA: "Go live →"

Step 7: Go live
  └─ Pre-flight checklist:
      ✅ At least 1 action exposed
      ✅ User identity endpoint configured and tested
      ✅ At least 1 channel connected and verified
      ✅ Playbook has at least 1 active state
      ⚠️ No SOC2 report uploaded (warning, not blocker for non-enterprise)
  └─ Deployment mode selector: Immediate / Shadow / Gradual
  └─ "Publish playbook" button — promotes draft to active
```

```typescript
// Wizard state machine — persisted to backend so refresh doesn't reset progress
export interface OnboardingState {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  specId?: string;
  channelId?: string;
  playbookId?: string;
  testSessionId?: string;
}

export enum OnboardingStep {
  ConnectAPI        = 'connect_api',
  ReviewActions     = 'review_actions',
  ConfigureIdentity = 'configure_identity',
  ConnectChannel    = 'connect_channel',
  ReviewPlaybook    = 'review_playbook',
  TestBot           = 'test_bot',
  GoLive            = 'go_live',
  Complete          = 'complete',
}
```

## 8.6 Playbook editor

The playbook editor is the most complex UI in the platform. Three sub-surfaces: the lifecycle state machine, the trigger rule builder, the fallback ladder editor.

### 8.6.1 Lifecycle state machine

Renders the user lifecycle as an interactive node graph. Nodes are states, edges are triggered transitions. Clicking a node opens the `BehaviorBundleEditor`. State node displays: state key and label, behavior summary (3-line: persona snippet, allowed action count, KB scope count), "default state" badge, "X triggers point here" badge for incoming transitions. The graph is informational — actual transitions are driven by trigger rules. Edges auto-drawn when a trigger action of type `transition_state` exists.

### 8.6.2 Behavior bundle editor

Side panel when state node clicked, or full-page from states route. Sections:

1. **State Identity** — Key (read-only after creation), Label (editable), Description (free text, guides state inference), Inference hints (tag input).
2. **Persona & Tone** — Persona textarea, Tone guidelines list, Opening behavior radio with preview, preview of opening message.
3. **Allowed Actions** — Multi-select from exposed actions. Search/filter by name/tag/tier. Warnings: "Bot will be read-only" if none selected. "Tier 3 in vulnerable state" warning.
4. **Knowledge Base Scope** — Multi-select from KB collections. "All collections" toggle (not recommended).
5. **Response Constraints** — Confidence floor slider (0–1, default 0.6), Max response length (optional), Require confirmation starting at tier dropdown.
6. **Save & preview** — Save draft (inline toast), "Preview in bot" opens test chat with state forced active.

### 8.6.3 Trigger rule builder

List of triggers per playbook version. Each card: `[Event] when [Condition] → [Action]`.

- **Event selector:** Message received (default), Action succeeded, Action failed, State entered, Session started.
- **Condition builder (visual AND/OR tree):** Message contains, Message intent, State is, Action count, Consecutive failures. Nested AND/OR allowed.
- **Action selector:** Transition to state, Escalate to human, Send message (template key), Invoke action (with args), Set metadata.
- Trigger card shows plain-English summary.
- Toggle enabled/disabled per trigger (no delete — disable for auditability).

### 8.6.4 Fallback ladder editor

Ordered drag-to-reorder list. Each step card: Order number, Strategy name with icon, Max attempts stepper, Message template textarea with variable hints, Preview button. Fixed escalate step always at bottom — cannot be removed or reordered.

### 8.6.5 Playbook versioning & deployment

Version history table: Version, Status, Created, Published, Traffic %, Actions.

Deploy modal:
- **Step 1: Pre-deployment checks** — All states have ≥1 allowed action, all triggers valid, fallback has escalate as final, eval suite passed (warning if no suite).
- **Step 2: Choose mode** — Immediate (replace now), Shadow (parallel, log only; duration 7 days; auto-promote/stay/notify), Gradual (N% traffic, ramp manual/+10%/day/+25%/day).
- **Step 3: Confirm** — Summary of change, Cancel, Deploy.

## 8.7 Policy editor (action definitions)

Per action page:

- **Header:** key, HTTP method badge, path. Status: Exposed/Hidden toggle (prominent).
- **Section 1: Description** — Editable. "Regenerate with AI" button re-runs LLM enrichment.
- **Section 2: Risk Tier** — Selector: 0 Read / 1 Reversible / 2 State Update / 3 Destructive. Visual explainer for selected tier. Step-up override toggle.
- **Section 3: Confirmation Copy (Tier 1+)** — Textarea with `{variable}` chips. Live preview with example args. Before/after template (Tier 2+).
- **Section 4: Permissions** — Required permissions tag input. "Any verified user" toggle.
- **Section 5: Constraints** — Add constraint: type → field → value. Constraint chips. Pre-conditions similar UI.
- **Section 6: Rate Limiting** — Per user per hour (0 = no limit).
- **Section 7: Post-action Message** — Textarea with response field hints. Preview with example values.
- **Section 8: Audit Fields** — Multi-select from input args + response fields.
- **Section 9: Test** — Inline test form, raw request/response/latency. Only Tier 0 in test mode.
- **Save** — saves to draft. Changes take effect only when playbook is redeployed. Change history list.

## 8.8 Knowledge base manager

Collections list page: Name, Documents, Chunks, Last indexed, Status, Actions.

Collection detail page tabs:
- **Sources tab** — Upload zone (drag-and-drop PDF/DOCX/MD/TXT), URL crawl (URL + depth selector), connected sources list with last-crawled, reindex per source, remove source.
- **Chunks tab** — Searchable table of all chunks (debugging). Columns: Source, Content preview, Token count, Last updated. "Test retrieval" with query → returns chunks + scores.
- **Settings tab** — Name, description, Chunk size slider, Overlap slider, Embedding model (read-only at tenant level).
- "Reindex all" triggers full re-embedding.

## 8.9 Channel configuration

Channel cards per channel type. Connected: green status, edit/test/disconnect. Available: Connect button.

**WhatsApp connect flow:** Connect with Meta (OAuth popup) → select WABA and phone number → platform generates webhook URL → copy webhook URL + screenshot guide for Meta App settings → test connection (send to test number) → configure business hours, fallback message, inbound/outbound toggles.

**Voice connect flow:** Provider selector (Twilio/Telnyx) → SID and Auth Token (masked after save) → phone number selector (fetched from provider API) → copy webhook URL for inbound → outbound toggle + caller ID selector.

**Web chat connect flow:** Widget appearance (primary color, bot name, avatar) → install code snippet for `<head>` → test in browser button.

## 8.10 Agent inbox (thin V1)

The inbox is deliberately thin in V1. Handles escalated conversations only — no proactive outreach, no SLA management.

- **Left panel — Conversation list:** Tabs (Unassigned / Mine / All). Rows: avatar, user display name, last message preview, time, channel icon, state badge. Sort newest first. Filter by channel/state. Real-time updates on WebSocket events. Unread badge count in nav.
- **Right panel — Conversation detail:** Header (user name + external ID + state badge + channel icon). Claim/Resolve/Mark urgent buttons. Conversation thread (bot + user turns chronologically). Bot turns show model used, confidence, actions called (expandable). Action calls shown as `[Action: update_plan] → Success` or `[Action: cancel_account] → Blocked (step-up required)`. Reply composer (textarea, Cmd+Enter to send, plain text only in V1).
- **User context panel (right sidebar, collapsible):** Display name, email, plan (from SaaS API context). Current state + confidence. Session info. Recent actions (last 5). "View full audit trail" link.

WebSocket events: `conversation.escalated` (new row in Unassigned), `conversation.message` (new message in open conversation), `conversation.claimed` (shows agent name), `conversation.resolved` (removed from queues).

```typescript
// packages/types/src/inbox.ts

export interface InboxConversation {
  id: string;
  tenantId: string;
  identityId: string;
  displayName?: string;
  channelType: ChannelType;
  currentUserState: string;
  escalationReason: string;
  priority: 'normal' | 'urgent';
  assignedToId?: string;
  assignedToName?: string;
  status: 'unassigned' | 'assigned' | 'resolved';
  lastMessageAt: Date;
  escalatedAt: Date;
  messagePreview: string;
  unreadCount: number;
}

export interface AgentReply {
  conversationId: string;
  text: string;
  agentId: string;
  channelType: ChannelType;
}
```

## 8.11 Analytics dashboard

Date range picker (default 7 days). Auto-refresh toggle.

- **Row 1: Summary cards** — Total conversations, Bot resolution rate, Avg response time, Escalation rate. Each shows trend vs previous period.
- **Row 2: Volume chart** — Line chart, conversations per day, split by channel.
- **Row 3: Resolution breakdown** — Donut (Bot resolved / Escalated / Abandoned). Table: top 5 escalation reasons.
- **Row 4: State distribution** — Bar chart of conversation count per lifecycle state. Helps spot inference issues.
- **Row 5: Top intents/actions** — Table: action key, invocation count, success rate, avg latency, tier.
- **Row 6: Playbook performance** (if gradual rollout active) — Side-by-side: active vs new version. Resolution rate, escalation rate, confidence, action success. "Promote new version" CTA if winning.
- **Row 7: LLM cost** (platform-managed tenants only) — Daily cost line chart. Breakdown by model/channel. Projected monthly.
- **Row 8: Failed turns log** — Last 50 failures. Click row → opens conversation in inbox.

## 8.12 Eval harness UI

Eval suite list: Name, Scenario count, Last run, Pass rate, Actions.

Suite detail tabs:
- **Scenarios** — List of test scenarios. Create scenario: name, ordered steps `{role: 'user' | 'assert', content}`. Assert steps: plain-English assertions e.g. "Bot should call get_account_status action", "Bot should NOT escalate to human". Expected final state dropdown. "Import from production" converts real conversation to scenario.
- **Run** — "Run all" button. Playbook version selector (draft/shadow/active). Progress bar. Results table: Scenario, Status, Steps passed, Failure step, Duration. Expandable detail: turn-by-turn transcript, per-assert pass/fail + explanation, actions called, state changes.
- **Compare** (when 2+ versions run) — Side-by-side: A vs B. Pass rate, confidence, action success, latency. Diff view of scenarios differing between versions.
- **Replay** — "Import production conversations" with date range → pulls PII-redacted conversations. "Run replay" re-processes against selected version. Diff view: original vs new responses. LLM-as-judge for better/worse direction.

## 8.13 BYOK configuration

Current LLM config card: Mode (Platform/BYOK), Provider, Model, Status.

Switch to BYOK: Provider selector → Model dropdown → API key input (masked after save, stored encrypted) → "Test connection" (cheap completion call) → shows valid/invalid/rate-limited → cost note: "With BYOK, LLM costs are charged directly to your provider account. Platform fee reduced accordingly." → Save.

Switch to platform-managed: "You will be billed at our standard rates." → "Your BYOK key will be deleted." → confirm.

Usage (platform-managed): This month tokens + cost. Breakdown by model.

## 8.14 Settings, Team, Billing, Compliance

### Team management
Members table: Name, Email, Role, Joined, Actions. Roles: Owner (1 max), Admin, Member. Invite by email (48h expiry). Permissions: Owner — everything including delete tenant; Admin — everything except billing/delete; Member — view + inbox only.

### Billing
Current plan card. Usage this period: agent seats, conversations (X/Y bar), voice minutes, LLM cost (platform-managed), overage charges. Upgrade/downgrade modal. Payment method. Invoice history with PDF download. Enterprise: "Contact us" instead of self-serve.

### Compliance
Data residency (set at signup, no change without migration). Data retention: 90d/1y/3y/indefinite for conversations; audit always indefinite. PII redaction toggle. GDPR: DPA download, DSAR by external user ID (export JSON), right to erasure by external user ID. Audit log export with date range. SOC2 report (upload yours or download ours).

## 8.15 Design system principles

These are not aesthetic preferences — they affect build decisions:

1. **Information density over whitespace.** B2B tool for hours of use. Dense tables, compact cards, collapsible panels.
2. **Inline feedback over modals for non-destructive actions.** Save shows toast. Modals only for destructive actions and multi-step flows.
3. **Draft / publish is first-class.** Every playbook/policy change is a draft. Live config always visible. Diff surfaced before publish.
4. **Warnings before problems, not after.** If admin exposes Tier 3 action in `at_risk` state, warning shows inline immediately.
5. **Empty states teach.** "Your playbook has no states yet. States define how your bot behaves for different users. Start with the auto-generated draft from your API spec." Not "No items found."
6. **Progressive disclosure.** Basic config prominent. Advanced (arg constraints, pre-conditions, audit fields) in collapsible "Advanced" section, closed by default.

## 8.16 API endpoints (admin-facing)

```
# Onboarding
GET    /api/v1/onboarding/state                 Get progress
POST   /api/v1/onboarding/state                 Update step
POST   /api/v1/onboarding/test-bot              Start test session
POST   /api/v1/onboarding/go-live               Pre-flight + publish

# Playbook management
GET    /api/v1/playbooks                        List versions
POST   /api/v1/playbooks                        Create draft
GET    /api/v1/playbooks/:id                    Get config
PUT    /api/v1/playbooks/:id                    Update draft
POST   /api/v1/playbooks/:id/deploy             Deploy with mode + rollout
POST   /api/v1/playbooks/:id/archive            Archive
GET    /api/v1/playbooks/:id/diff               Diff vs active

# Inbox
GET    /api/v1/inbox/conversations              List (paginated, filtered)
POST   /api/v1/inbox/conversations/:id/claim    Claim
POST   /api/v1/inbox/conversations/:id/reply    Agent reply
POST   /api/v1/inbox/conversations/:id/resolve  Mark resolved
POST   /api/v1/inbox/conversations/:id/urgent   Mark urgent
GET    /api/v1/inbox/conversations/:id/turns    Full turns

# Analytics
GET    /api/v1/analytics/summary                Summary cards
GET    /api/v1/analytics/volume                 Volume by day + channel
GET    /api/v1/analytics/resolution             Resolution breakdown
GET    /api/v1/analytics/states                 State distribution
GET    /api/v1/analytics/actions                Action stats
GET    /api/v1/analytics/cost                   LLM cost breakdown
GET    /api/v1/analytics/failed-turns           Recent failed turns

# Evals
GET    /api/v1/evals/suites                     List suites
POST   /api/v1/evals/suites                     Create suite
GET    /api/v1/evals/suites/:id/scenarios       List scenarios
POST   /api/v1/evals/suites/:id/scenarios       Create scenario
POST   /api/v1/evals/suites/:id/run             Trigger run
GET    /api/v1/evals/runs/:id                   Get results
POST   /api/v1/evals/replay                     Start replay run

# KB
GET    /api/v1/kb/collections                   List
POST   /api/v1/kb/collections                   Create
POST   /api/v1/kb/collections/:id/sources       Add source
DELETE /api/v1/kb/collections/:id/sources/:sid  Remove
POST   /api/v1/kb/collections/:id/reindex       Reindex
POST   /api/v1/kb/collections/:id/test          Test retrieval

# Team
GET    /api/v1/team/members                     List
POST   /api/v1/team/invites                     Send invite
DELETE /api/v1/team/members/:id                 Remove
PATCH  /api/v1/team/members/:id/role            Change role

# Settings
GET    /api/v1/settings                         Get all
PATCH  /api/v1/settings/llm                     Update LLM (BYOK or platform)
POST   /api/v1/settings/llm/test                Test connection
PATCH  /api/v1/settings/compliance              Update retention
POST   /api/v1/settings/compliance/dsar         Trigger DSAR
POST   /api/v1/settings/compliance/erasure      Right-to-erasure
GET    /api/v1/settings/billing                 Billing + usage
```

## 8.17 Database schema

```typescript
// packages/db/src/schema/admin.ts

export const onboardingStates = pgTable('onboarding_states', {
  tenantId:       uuid('tenant_id').primaryKey().references(() => tenants.id),
  currentStep:    varchar('current_step', { length: 50 }).notNull().default('connect_api'),
  completedSteps: jsonb('completed_steps').notNull().default('[]'),
  specId:         uuid('spec_id'),
  channelId:      uuid('channel_id'),
  playbookId:     uuid('playbook_id'),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
});

export const kbCollections = pgTable('kb_collections', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  chunkSize:   integer('chunk_size').notNull().default(512),
  overlap:     integer('overlap').notNull().default(50),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export const kbSources = pgTable('kb_sources', {
  id:           uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => kbCollections.id),
  tenantId:     uuid('tenant_id').notNull(),
  type:         varchar('type', { length: 20 }).notNull(),    // 'file' | 'url' | 'crawl'
  name:         varchar('name', { length: 255 }).notNull(),
  url:          text('url'),
  storageKey:   text('storage_key'),
  status:       varchar('status', { length: 50 }).notNull().default('pending'),
  chunkCount:   integer('chunk_count'),
  indexedAt:    timestamp('indexed_at'),
  errorMessage: text('error_message'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
});

export const evalSuites = pgTable('eval_suites', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull().references(() => tenants.id),
  name:        varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
});

export const evalScenarios = pgTable('eval_scenarios', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  suiteId:            uuid('suite_id').notNull().references(() => evalSuites.id),
  tenantId:           uuid('tenant_id').notNull(),
  name:               varchar('name', { length: 255 }).notNull(),
  steps:              jsonb('steps').notNull(),
  expectedFinalState: varchar('expected_final_state', { length: 100 }),
  createdAt:          timestamp('created_at').notNull().defaultNow(),
});

export const evalRuns = pgTable('eval_runs', {
  id:              uuid('id').primaryKey().defaultRandom(),
  suiteId:         uuid('suite_id').notNull().references(() => evalSuites.id),
  tenantId:        uuid('tenant_id').notNull(),
  playbookId:      uuid('playbook_id').notNull(),
  playbookVersion: varchar('playbook_version', { length: 20 }).notNull(),
  status:          varchar('status', { length: 50 }).notNull().default('pending'),
  passCount:       integer('pass_count'),
  failCount:       integer('fail_count'),
  results:         jsonb('results'),
  startedAt:       timestamp('started_at'),
  completedAt:     timestamp('completed_at'),
  createdAt:       timestamp('created_at').notNull().defaultNow(),
});

export const escalations = pgTable('escalations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  tenantId:       uuid('tenant_id').notNull(),
  reason:         text('reason').notNull(),
  priority:       varchar('priority', { length: 20 }).notNull().default('normal'),
  status:         varchar('status', { length: 20 }).notNull().default('unassigned'),
  assignedToId:   uuid('assigned_to_id'),
  claimedAt:      timestamp('claimed_at'),
  resolvedAt:     timestamp('resolved_at'),
  createdAt:      timestamp('created_at').notNull().defaultNow(),
});
// Index: (tenant_id, status, created_at) — inbox queue query
```

## 8.18 Acceptance criteria

**Given** a new tenant completes signup
**When** they land on the dashboard for the first time
**Then** the onboarding wizard is shown automatically and the current step persists across refreshes.

**Given** an admin uploads an OpenAPI spec in the wizard
**When** ingestion completes
**Then** the wizard advances to step 2 with parsed actions table and tier badges; LLM-enriched descriptions are flagged with "AI-generated" badges.

**Given** an admin completes all 7 onboarding steps
**When** they click "Go live"
**Then** pre-flight checklist runs, blocking issues shown with fix links, playbook published only if all blocking checks pass.

**Given** an admin edits a behavior bundle
**When** they add a Tier 3 action to `at_risk` state
**Then** inline warning appears: "Tier 3 actions in retention-focused states may increase churn risk. Review your confirmation copy carefully."

**Given** an admin deploys a new playbook with gradual 20%
**When** 100 new conversations start
**Then** approximately 20 route to new version, verified via analytics playbook performance comparison.

**Given** a conversation is escalated to inbox
**When** an agent is viewing the inbox
**Then** the new conversation appears at the top of Unassigned tab within 3 seconds without page refresh.

**Given** an agent claims and replies to an escalation
**When** the reply is sent
**Then** message delivered on same channel user used; conversation status updates to "assigned" in real time for other agents.

**Given** an eval scenario is run against a draft
**When** an assert step fails
**Then** failure shown with actual bot response, expected assertion, diff highlighting mismatch.

**Given** a BYOK key is entered and saved
**When** the key is retrieved via any admin API
**Then** key value not present in response — only masked (last 4 chars) shown.

**Given** an admin triggers DSAR export
**When** export is ready
**Then** downloadable JSON contains all turns, action invocations, sessions, identity data for that user — and nothing else.

## 8.19 Test cases

### Unit tests (frontend)

| Test | What it verifies |
|---|---|
| `OnboardingWizard` shows correct step based on `currentStep` | Step rendering |
| Wizard does not advance to step 3 if no actions exposed | Step gate |
| `BehaviorBundleEditor` shows Tier 3 warning when Tier 3 added to `at_risk` | Inline warning |
| `TriggerBuilder` renders plain-English summary from config | Summary rendering |
| `FallbackLadder` disables reordering of escalate step | Escalate lock |
| `PolicyEditor` masks API key after save — shows only last 4 chars | Secret masking UI |
| `AnalyticsDashboard` renders empty state when no data | Empty state |
| Inbox list updates real-time on WebSocket `conversation.escalated` | Real-time update |

### Integration tests (API)

| Test | What it verifies |
|---|---|
| `POST /onboarding/go-live` missing user context endpoint → pre-flight failure | Pre-flight check |
| `POST /playbooks/:id/deploy` gradual 30% → active serves 70% | Gradual rollout |
| `POST /kb/collections/:id/sources` PDF upload → indexed in pgvector within 60s | KB indexing |
| `GET /inbox/conversations` returns only escalations for requesting tenant | Tenant isolation |
| `POST /inbox/conversations/:id/reply` → message delivered via Layer 2 outbound queue | Reply delivery |
| `POST /evals/suites/:id/run` → results include pass/fail per scenario | Eval runner |
| `POST /settings/compliance/erasure` → all data deleted for user | GDPR erasure |
| `POST /settings/llm/test` invalid BYOK → error without crashing | Key test error |

### E2E tests (Playwright, staging)

| Test | What it verifies |
|---|---|
| Full onboarding: upload spec → configure → connect WA → test → go live | Onboarding E2E |
| Edit behavior bundle → save → deploy → bot uses new behavior in test chat | Playbook deploy E2E |
| Escalate test conversation → inbox shows it → agent claims + replies → user receives | Inbox E2E |
| Create eval scenario → run → see pass/fail | Eval E2E |

## 8.20 Definition of done for Layer 6

- [ ] Onboarding wizard: all 7 steps, progress persisted, pre-flight before go-live.
- [ ] Playbook editor: state graph, behavior bundle editor, trigger builder, fallback ladder all implemented.
- [ ] Playbook deployment: immediate, shadow, gradual modes with correct routing.
- [ ] Policy editor: all action fields editable, inline test for Tier 0, change history.
- [ ] KB manager: upload, URL crawl, chunk viewer, test retrieval, reindex.
- [ ] Channel configuration: all channel types' connect flows.
- [ ] Agent inbox: real-time escalation list, claim, reply, resolve, context panel.
- [ ] Analytics: all 8 metric sections, date range filtering.
- [ ] Eval harness: scenario creation, run execution, replay from production.
- [ ] BYOK config: key entry, encrypted storage, test connection, masked display.
- [ ] Team management: invite, role change, remove.
- [ ] Billing: usage display, plan change, invoices.
- [ ] Compliance: DSAR export, right-to-erasure, audit export.
- [ ] All Postgres tables created via migrations.
- [ ] All API endpoints implemented.
- [ ] All acceptance criteria pass.
- [ ] All tests pass.
- [ ] Runbook: onboarding stuck (spec ingestion failure), inbox WebSocket disconnect, eval runner timeout.

---

# Part 9 — UI Specifications: Landing, Onboarding, Workflow

> **Status:** PLACEHOLDER — populate from user-supplied HTML
> **Build target:** `apps/admin/app/`, marketing site (TBD repo), design system tokens in `apps/admin/styles/`

This part is reserved for the concrete UI: the Landing page (marketing/site), the Onboarding flow (wizard surface), and the Workflow page (playbook editor or main workspace canvas). The user will supply the HTML for these screens in the next message. When that arrives, this section gets populated with:

- **Design tokens extracted from the HTML:** color palette, typography scale, spacing scale, radius system, shadow system, motion tokens.
- **Component inventory:** every recurring component lifted from the HTML (button variants, input styles, card variants, modal, drawer, table, badge, chip, toast, tooltip, etc.) with names mapped onto the shadcn/ui base components and Tailwind extensions.
- **Per-page build spec:**
  - **Landing page** — sections, hero, feature blocks, social proof, pricing comparison, CTA. Implemented as a separate marketing site (e.g. `apps/marketing` on Next.js static export, deployed independently).
  - **Onboarding** — wired into the wizard described in §8.5. The HTML defines the visual treatment for each step's panel, stepper, inline tier explainer, action review table, channel connect cards, pre-flight checklist, success state. Component-level instructions appended here.
  - **Workflow page** — this maps to the playbook editor (§8.6). State graph rendering style (node shape, edge style, hover/selected states, default state badge), behavior bundle editor side panel layout, trigger card visual, fallback ladder card visual. Component-level instructions appended here.

### Build instruction once HTML arrives

For Claude Code consuming this manual:
1. Read each HTML file under `/inputs/ui/` (Landing, Onboarding, Workflow).
2. Extract design tokens into `apps/admin/tailwind.config.ts` extending the shadcn/ui base.
3. Build a primitives layer in `apps/admin/components/ui/` for any custom components beyond shadcn defaults.
4. For each page route, compose primitives + shadcn components to match the HTML's visual layout while reading data from the API endpoints in §8.16.
5. Pixel-match is not the goal; visual coherence is. The HTML is the design language; the routes are the React app.

### Hand-off contract from the marketing site to the app

If Landing is built as a separate marketing site:
- "Get started" CTA links to `app.{domain}/signup` — handed off to the Clerk-managed signup flow.
- "Log in" CTA links to `app.{domain}/login`.
- Shared brand assets (logo SVG, favicon, OG image) live in `packages/brand-assets` and are consumed by both `apps/marketing` and `apps/admin`.
- Visual tokens shared via `packages/design-tokens` (Tailwind preset + CSS variables exported for both).

> *Section to be populated by Claude Code once the HTML files for Landing, Onboarding, and Workflow are placed under `/inputs/ui/`.*

---

# Part 10 — Cross-Layer Integration Testing

> **Build target:** `apps/eval-runner/` for offline runs, `tests/integration/` at repo root for cross-app integration tests, `tests/e2e/` for Playwright E2E.

Every layer has its own unit and integration tests inside its app. This Part defines the **cross-layer** tests that verify the system as a whole.

## 10.1 The four cross-layer scenarios that must work

Each scenario exercises 3+ layers and must pass before any release tag.

### Scenario A — First-touch verified action

User has never contacted before. Sends a WhatsApp message. Verifies via magic link. Bot calls a Tier 0 action and returns the result.

```
1. POST /webhooks/whatsapp/test-tenant with signed payload
2. Assert: identity created, magic link sent (outbound queue contains one message)
3. Click magic link → POST /verify/:token
4. Assert: identity.verifiedAt set, session created in Redis
5. POST inbound message "what's my plan?"
6. Assert: turn created, get_account_status action invoked (Tier 0, immediate),
   outbound message contains plan name
```

Touches Layer 2 (webhook), Layer 3 (identity, session, magic link), Layer 4 (agent runtime, state inference), Layer 5 (action execution, auth proxy).

### Scenario B — Tier 3 with step-up

Verified user with active session. Asks to cancel subscription. Tier 3 action — must request step-up. After step-up, action executes.

```
1. Seed: verified identity with active session, no step-up
2. POST inbound message "I want to cancel my subscription"
3. Assert: Tier 3 detected, confirmation request returned, NOT executed
4. POST inbound message "yes confirm"
5. Assert: step-up initiated, outbound contains step-up link
6. Click step-up link → POST /step-up/:token
7. Assert: session.stepUpCompletedAt set
8. POST inbound message "ok done" (or auto-resume)
9. Assert: cancel_subscription action invoked, audit log shows full chain
```

Touches Layer 3 (step-up), Layer 4 (tool loop), Layer 5 (tier enforcement, confirmation token, TOCTOU protection).

### Scenario C — State transition via trigger

Verified user. Sends a "cancel" keyword. Trigger fires, transitions user to `at_risk` state, retention behavior bundle takes over.

```
1. Seed: verified identity in `early_user` state. Playbook has trigger:
   "message_contains 'cancel' → transition_state at_risk"
2. POST inbound message "I want to cancel"
3. Assert: trigger fired, currentUserState = 'at_risk',
   behavior bundle = retention_mode, response uses retention persona
```

Touches Layer 4 (trigger engine, state inference, behavior bundle resolution).

### Scenario D — Cross-channel session stitching

User verified on WhatsApp. Calls in by voice from same number. Should not re-OTP.

```
1. Seed: verified identity with WhatsApp channel (trusted)
2. Twilio inbound call webhook → /webhooks/voice/test-tenant with caller ID
   matching the verified WA number
3. Assert: identity stitched (no OTP triggered), session.channels includes 'voice'
4. POST voice transcript "what's my latest invoice?"
5. Assert: action invoked, voice TTS response sent
```

Touches Layer 2 (voice webhook), Layer 3 (stitching), Layer 4 (agent), Layer 5 (action).

## 10.2 Eval scenarios for the runtime

The `apps/eval-runner` consumes scenarios stored in the database (created via the admin UI, §8.12) and runs them. The runner:

- Loads scenario steps in order.
- For each `user` step, sends an inbound message through the same agent runtime code path as production.
- For each `assert` step, evaluates against the actual bot output. Assert types: `action_called`, `action_not_called`, `state_transitioned`, `response_contains`, `response_does_not_contain`, `escalation_triggered`, `final_state_is`.
- Writes results to `eval_runs.results`.
- For LLM-as-judge assertions, makes a separate Haiku-class LLM call with the rubric + actual response.

```typescript
// apps/eval-runner/src/runner.ts

export class EvalRunner {
  async runSuite(suiteId: string, playbookVersion: string): Promise<EvalRunResult> {
    const scenarios = await this.scenarioRepo.list(suiteId);
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await this.runScenario(scenario, playbookVersion));
    }
    return {
      passCount: results.filter(r => r.passed).length,
      failCount: results.filter(r => !r.passed).length,
      results,
    };
  }

  private async runScenario(scenario: EvalScenario, playbookVersion: string): Promise<ScenarioResult> {
    // Spin up a sandboxed conversation
    const sandboxConversationId = await this.sandbox.createConversation({
      tenantId: scenario.tenantId,
      playbookVersion,
    });

    const stepResults: StepResult[] = [];
    for (const step of scenario.steps) {
      if (step.role === 'user') {
        const outcome = await this.sandbox.sendMessage(sandboxConversationId, step.content);
        stepResults.push({ stepType: 'user', passed: true, recorded: outcome });
      } else {
        const passed = await this.evaluateAssert(step, sandboxConversationId);
        stepResults.push({ stepType: 'assert', passed, content: step.content });
        if (!passed) break; // Stop on first failed assert
      }
    }

    return { scenarioId: scenario.id, passed: stepResults.every(s => s.passed), stepResults };
  }
}
```

## 10.3 Replay testing

The replay flow takes PII-redacted production conversations and re-runs them against a new playbook version. Results are diffed for direction (better/worse) using LLM-as-judge.

```typescript
// apps/eval-runner/src/replay.ts

export class ReplayRunner {
  async run(req: ReplayRunRequest): Promise<ReplayResult> {
    const conversations = await this.conversationRepo.fetchForReplay({
      tenantId: req.tenantId,
      from: req.from,
      to: req.to,
      limit: req.limit,
      piiRedacted: true,  // Always redacted
    });

    const diffs: ReplayDiff[] = [];
    for (const conv of conversations) {
      const newResponses: Turn[] = [];
      const sandboxId = await this.sandbox.createConversation({
        tenantId: req.tenantId,
        playbookVersion: req.targetVersion,
      });
      for (const userTurn of conv.turns.filter(t => t.role === 'user')) {
        const outcome = await this.sandbox.sendMessage(sandboxId, (userTurn.content as TextContent).text);
        newResponses.push(outcome);
      }
      diffs.push({
        conversationId: conv.id,
        originalResponses: conv.turns.filter(t => t.role === 'assistant'),
        newResponses,
        judgement: await this.judgeWithLLM(conv.turns, newResponses),
      });
    }
    return { diffs, summary: this.summarize(diffs) };
  }
}
```

## 10.4 Load test scenarios

Cross-layer load tests run via k6 against staging.

| Scenario | Target | P95 threshold |
|---|---|---|
| WhatsApp inbound → agent runtime → response | 200 RPS | < 3s |
| Voice inbound transcript → response | 50 RPS | First audio < 800ms |
| Concurrent step-up flows | 100 concurrent | < 5s end-to-end |
| Mass eval suite execution | 500 scenarios in parallel | All complete < 60s |

## 10.5 Definition of done for cross-layer testing

- [ ] Scenarios A, B, C, D all implemented as automated integration tests.
- [ ] `apps/eval-runner` can execute a suite end-to-end with all assert types.
- [ ] Replay runner can pull from a date range and produce a diff report.
- [ ] k6 load test scripts checked in under `tests/load/`.
- [ ] CI runs Scenarios A–D against staging on every merge to main.
- [ ] Load tests run weekly via scheduled GitHub Action against staging.

---

# Part 11 — Per-App Deployable Specifications

Each app is independently deployable. This part gives a self-contained spec for each: what it runs, what it depends on, what env vars it needs, and what scale parameters look like.

## 11.1 `apps/api` — Core Backend

**Stack:** NestJS 10 + Fastify adapter, Node 22, TypeScript.

**Responsibilities:**
- Admin REST API (every endpoint in §6.16, §7.11, §8.16)
- Magic link verification page (`GET/POST /verify/:token`)
- Step-up verification page (`POST /step-up/:token`)
- Webhook handlers for non-voice channels (`/webhooks/whatsapp/:slug`, `/webhooks/slack/:slug`, `/webhooks/teams/:slug`, `/webhooks/sms/:slug`)
- Internal RPC for `channel-worker` and `voice-worker` (over Redis pub/sub + direct HTTP)
- Background job consumers via BullMQ (spec ingestion, playbook bootstrap, KB indexing, DSAR exports)

**Dependencies:** Postgres 16, Redis 7, S3 bucket (`uploads-{region}` for files), KMS key for envelope encryption, Clerk webhook for admin auth events.

**Env vars (in addition to `packages/config` base schema):**
```
APP_NAME=api
PORT=3000
BASE_URL=https://api.example.com
CLERK_SECRET_KEY=sk_xxx
CLERK_WEBHOOK_SECRET=whsec_xxx
S3_BUCKET_UPLOADS=uploads-us-east-1
S3_BUCKET_EXPORTS=exports-us-east-1
KMS_KEY_ID=arn:aws:kms:us-east-1:xxx:key/yyy
STRIPE_SECRET_KEY=sk_live_xxx        # For billing
META_APP_SECRET=xxx                   # For WhatsApp signature verification
TWILIO_AUTH_TOKEN=xxx                 # Voice/SMS signature verification
```

**Scaling:** Stateless. Horizontal pod autoscaler 3–20 replicas. CPU target 60%. Sticky sessions NOT needed.

**Healthcheck:** `GET /healthz` returns 200 with `{db, redis, queue}` status; `GET /readyz` adds queue depth and migration version.

## 11.2 `apps/admin` — SaaS-Facing Dashboard

**Stack:** Next.js 15 (App Router), React 19, TypeScript, server components by default.

**Responsibilities:** Every screen in Part 8 — onboarding, playbook editor, policy editor, KB manager, channels, inbox, analytics, evals, settings.

**Dependencies:** `apps/api` (all data flows through API client). Clerk for auth (uses ClerkProvider).

**Env vars:**
```
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_xxx
CLERK_SECRET_KEY=sk_xxx
NEXT_PUBLIC_WS_URL=wss://api.example.com
```

**Scaling:** Edge-deployed on Vercel (or self-hosted Next.js on EKS). Cached pages served from CDN. API routes (server actions) hit `apps/api`.

## 11.3 `apps/channel-worker` — Channel Adapters

**Stack:** Fastify (lightweight, no DI overhead), Node 22, TypeScript.

**Responsibilities:**
- Inbound webhook handlers for low-latency paths (when keeping NestJS startup cost off the hot path matters)
- WebSocket server for web chat (`/ws/chat/:tenantSlug`)
- Outbound delivery for WhatsApp, Slack, Teams, SMS, Web (consumes `outbound_message` queue)
- WhatsApp template management (sync templates from Meta on schedule)

**Dependencies:** Postgres (read-only for channel config), Redis (sessions, pub/sub for web chat outbound), `apps/api` (for identity resolution via internal HTTP).

**Env vars:**
```
APP_NAME=channel-worker
PORT=3100
API_BASE_URL=http://api:3000          # Internal cluster URL
INTERNAL_SERVICE_SECRET=xxx           # Shared with apps/api
META_APP_SECRET=xxx
SLACK_SIGNING_SECRET=xxx
```

**Scaling:** Horizontal 3–10 replicas. Stateless except WebSocket connections — those are sticky by Redis-backed session.

## 11.4 `apps/voice-worker` — Real-time Voice

**Stack:** Fastify + native WebSocket, Node 22 (consider Bun for cold-start improvements when stable).

**Responsibilities:**
- Twilio voice webhook handler (returns TwiML)
- WebSocket media stream handler (Twilio → Deepgram)
- Real-time transcript dispatch into agent runtime
- TTS streaming back to Twilio (ElevenLabs or Cartesia)
- DTMF/speech OTP entry endpoints

**Dependencies:** Deepgram (streaming STT), ElevenLabs/Cartesia (streaming TTS), `apps/api` (identity, agent runtime).

**Env vars:**
```
APP_NAME=voice-worker
PORT=3200
DEEPGRAM_API_KEY=xxx
ELEVENLABS_API_KEY=xxx                # Or CARTESIA_API_KEY
API_BASE_URL=http://api:3000
TWILIO_AUTH_TOKEN=xxx
VOICE_WORKER_HOST=voice.example.com   # WebSocket-reachable hostname
```

**Scaling:** Each voice call holds one WebSocket. Capacity-plan by concurrent call count. Vertical-first (more CPU per pod) before horizontal. Pod allocation: 4 vCPU / 4 GB per pod, ~50 concurrent calls per pod. Autoscale on active connection count, not CPU.

**Critical:** Sticky sessions enforced via session affinity on Service. Mid-call failover not possible without recording-replay (V2).

## 11.5 `apps/eval-runner` — Offline Eval Harness

**Stack:** NestJS (shares modules with `apps/api`), runs as Kubernetes Job or BullMQ-triggered worker.

**Responsibilities:**
- Execute eval suites end-to-end (Part 10)
- Replay runs from production conversations
- Write results to `eval_runs.results`

**Dependencies:** Same as `apps/api` plus sandbox conversation infrastructure (a separate Postgres schema or in-memory Drizzle).

**Env vars:**
```
APP_NAME=eval-runner
EVAL_SANDBOX_DATABASE_URL=postgres://...    # Isolated from production data
```

**Scaling:** Kubernetes Jobs spawned per run by `apps/api`. Concurrency limit per tenant (default 3) prevents resource hogging.

## 11.6 Shared deployment topology

```
                            Internet
                                │
                                ▼
                       AWS Application Load Balancer
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
            apps/admin      apps/api      apps/voice-worker
              (Next.js)    (NestJS)        (Fastify + WS)
                                │
                                ▼
                        apps/channel-worker
                            (Fastify)
                                │
        ┌─────────────┬─────────┴────────────┬───────────────┐
        ▼             ▼                      ▼               ▼
    Postgres 16   Redis 7              S3                  KMS
   (RDS Multi-AZ) (ElastiCache)    (uploads + exports)  (envelope keys)
        │
        ▼
    pgvector
   (KB embeddings)
```

Cross-region read replicas of Postgres for EU and APAC. Per-region S3 buckets for data residency.

---

# Part 12 — Infrastructure & Deployment

> **Build target:** `infra/terraform/`, `infra/k8s/`, `.github/workflows/`

## 12.1 AWS topology per region

Each region is a fully isolated deployment. No cross-region data flow at runtime (only async backups).

```
VPC (10.x.0.0/16)
├── Public subnets (3 AZs) — ALB, NAT gateways
├── Private app subnets (3 AZs) — EKS nodes
├── Private data subnets (3 AZs) — RDS, ElastiCache
└── Endpoints — S3, KMS, ECR (no NAT egress for AWS services)

EKS cluster
├── Node group: general (m6i.xlarge, 3–20 nodes)
├── Node group: voice (c6i.2xlarge, 2–10 nodes, taint for voice-worker)
└── Karpenter for spot fallback on the general pool

RDS PostgreSQL 16
├── Multi-AZ primary
├── 2 read replicas (admin dashboard reads)
└── pgvector extension enabled

ElastiCache Redis 7
├── Cluster mode, 3 shards × 2 replicas
└── Used for sessions, BullMQ, working memory, rate limits

S3
├── uploads-{region}      — KB source files, eval scenarios
├── exports-{region}      — DSAR exports, audit log exports
├── recordings-{region}   — Voice call recordings (opt-in per tenant)
└── all server-side encrypted with tenant-specific KMS context

KMS
├── Master key per region (envelope encryption)
└── Tenant data keys derived per record, cached in app memory briefly

Secrets Manager
└── Per-app secrets, rotated quarterly

CloudFront
├── apps/admin static assets
└── Web chat widget JS SDK

Route53
└── Per-tenant verification subdomains (Enterprise feature, V1.5)
```

## 12.2 Terraform module layout

```
infra/terraform/
├── modules/
│   ├── vpc/
│   ├── eks/
│   ├── rds/
│   ├── elasticache/
│   ├── s3-tenant-data/
│   ├── kms/
│   ├── alb/
│   └── observability/
├── environments/
│   ├── staging-us-east-1/
│   ├── prod-us-east-1/
│   ├── prod-eu-west-1/
│   └── prod-ap-south-1/
└── shared/
    ├── route53/
    └── waf/
```

## 12.3 Kubernetes manifests

Helm charts per app, deployed via ArgoCD (GitOps). `infra/k8s/charts/{api, admin, channel-worker, voice-worker, eval-runner}/`.

Standard chart contents: Deployment, Service, HPA, PDB, NetworkPolicy, ServiceMonitor (Prometheus), and for voice-worker, a sessionAffinity-configured Service.

## 12.4 CI/CD pipeline

```
PR opened
  └─ CI gates (Part 2)
  └─ Build Docker images
  └─ Push to ECR with PR-SHA tag

Merge to main
  └─ Build + push images with main-SHA + 'latest' tag
  └─ ArgoCD detects new image
  └─ Deploys to staging automatically
  └─ Smoke tests run against staging
  └─ On pass: tag image as 'staging-stable'

Release tag (semver)
  └─ Promote staging-stable to prod
  └─ Region-by-region rollout: us-east-1 → eu-west-1 → ap-south-1
  └─ Canary 10% → 50% → 100% per region
  └─ Auto-rollback on error rate > 1% or P95 latency > 2x baseline
```

## 12.5 Disaster recovery

- **RPO target:** 5 minutes (continuous Postgres WAL shipping, S3 versioning).
- **RTO target:** 1 hour (warm standby in secondary AZ; cross-region failover requires manual cutover and is a V2 feature).
- **Backups:** Postgres PITR enabled, 35-day retention. S3 versioning + cross-region replication for `exports-` and `recordings-` buckets.
- **DR runbook:** documented in `infra/runbooks/dr.md` with quarterly drill.

---

# Part 13 — Observability, Security, Compliance

## 13.1 Observability

**Tracing:** OpenTelemetry SDK in every app. Spans propagate via W3C trace context across HTTP and BullMQ jobs. Trace exporter → Datadog APM.

**Logging:** Pino structured logs (Part 1.6) → stdout → Fluent Bit DaemonSet → Datadog Logs. Every log line carries tenantId, conversationId, traceId.

**Metrics:** Prometheus (via Datadog agent). Per-app SLI dashboards:
- API: request rate, error rate, P50/P95/P99 latency by endpoint
- Channel worker: webhook 200-rate, outbound delivery success rate
- Voice worker: active calls, mean first-audio latency, STT/TTS latency
- Agent runtime: turn count by tenant, LLM token rate, action invocation rate, fallback trigger rate

**LLM tracing:** Langfuse SDK in `packages/llm`. Every LLM call traced with: prompt, response, tokens, latency, cost, tenant, conversation. Sample rate 100% in V1 (cost-bearable); reduce later.

**Alerts:**
- P95 API latency > 2s for 5 min → PagerDuty
- Error rate > 1% for 5 min → PagerDuty
- Webhook 200-rate < 99% for 10 min → PagerDuty
- LLM provider error rate > 5% → PagerDuty (auto-fallback to secondary if configured)
- Database connection pool > 80% utilized → Slack
- BullMQ queue depth > 10000 → Slack
- Voice first-audio latency P95 > 1s for 5 min → PagerDuty

## 13.2 Security

**Encryption at rest:** All databases AWS-encrypted. Tenant secrets envelope-encrypted via KMS (Part 1.8). S3 buckets server-side encrypted.

**Encryption in transit:** TLS 1.3 only. mTLS between internal services (cert-manager in EKS).

**Network segmentation:** NetworkPolicy per app. apps/api can talk to RDS/Redis/S3/KMS. apps/channel-worker can talk to Redis + apps/api. Database not reachable from internet at all.

**Secret rotation:** Quarterly via Secrets Manager rotation Lambdas. Tenant BYOK keys re-encryptable on master key rotation.

**Audit logging:** Every state-changing admin API call writes to `audit_events`. Immutable. Per §1.9 RLS policy.

**WAF:** AWS WAF in front of ALB. OWASP Core Rule Set + custom rules for webhook abuse (rate limit by source IP per tenant slug).

**Penetration test:** Annual external pen test. First scheduled at M+9 (post-SOC2 Type II prep).

**Vulnerability scanning:** Snyk in CI; Trivy on container images at push; Dependabot for OS-level deps.

**Prompt injection defense:** System prompt is structurally separated from user input. Tool execution always passes through Layer 5 gates (Part 7), so even successful injection cannot bypass the policy layer. Continuous eval suite includes prompt injection test cases.

## 13.3 Compliance

**SOC2 Type I:** Month 3. Vanta from month 1 to automate evidence collection. First audit covers: change management, access control, encryption, incident response, vendor management.

**SOC2 Type II:** Month 12. Requires 6+ months of continuous evidence.

**GDPR:** From day 1.
- DPA available for download (`/legal/dpa`).
- DSAR endpoint: `POST /api/v1/settings/compliance/dsar` returns JSON export.
- Right-to-erasure: `POST /api/v1/settings/compliance/erasure` removes identity, all turns, action invocations, sessions. Audit_events retain hashed identity reference only.
- Data residency: tenant region locked at signup. Audit events for any cross-region access.

**HIPAA:** V2 productized. V1 case-by-case via signed BAA with isolated VPC deployment.

**PCI:** Not applicable in V1 (we don't process card data ourselves; tenant SaaS handles payments).

**ISO 27001:** Month 18.

---

# Part 14 — Build Milestones (M0–M6, week-by-week)

> **Calendar weeks from kickoff. Adjust based on team size.** Plan assumes 4 senior engineers + 1 designer.

## M0 — Bootstrap (Week 0)

- [ ] Repo created, monorepo scaffolded (Part 2).
- [ ] AWS accounts created (staging, prod).
- [ ] Terraform skeleton applied to staging.
- [ ] CI pipeline green.
- [ ] Vanta engaged.

## M1 — Foundations (Weeks 1–2)

- [ ] Layer 1 fully implemented (Part 3). All shared packages built, tested, ≥80% coverage.
- [ ] Auth: Clerk integrated for admin login.
- [ ] Base Postgres schema (tenants, admin_users, audit_events) migrated.
- [ ] Docker Compose dev environment runs cleanly.

## M2 — Channel Layer & Web Chat (Weeks 3–5)

- [ ] Layer 2 implemented (Part 4): WhatsApp inbound/outbound, web chat WebSocket, SMS.
- [ ] Test WhatsApp number connected via Meta Cloud API (sandbox).
- [ ] Web chat widget JS SDK shipped to npm under `@platform/web-widget`.
- [ ] Channel management API + admin UI for connecting channels.
- [ ] First DESIGN PARTNER targeted for end of week 5.

## M3 — Identity & Session (Weeks 6–7)

- [ ] Layer 3 implemented (Part 5): magic link, sessions, step-up, cross-channel stitching.
- [ ] Magic link verification page hosted on `verify.{domain}`.
- [ ] User context fetch from SaaS API working with test fixture.

## M4 — Playbook, Agent Runtime, Policy Layer (Weeks 8–11)

- [ ] Layer 4 implemented (Part 6): state inference, playbook engine, LLM abstraction, RAG, memory, tool loop, fallback.
- [ ] Layer 5 implemented (Part 7): spec ingestion (OpenAPI + Postman), action definitions, policy gates, auth proxy, playbook bootstrap.
- [ ] End-to-end: upload OpenAPI → bootstrap playbook → talk to bot via WhatsApp → Tier 0 action succeeds.
- [ ] First design partner pilot starts in staging at end of week 11.

## M5 — Admin Surface (Weeks 12–15)

- [ ] Layer 6 implemented (Part 8): onboarding wizard, playbook editor, policy editor, KB manager, channels, inbox, analytics, evals, settings.
- [ ] Self-serve onboarding tested end-to-end with 3 internal tenants.
- [ ] First design partner moved to production at end of week 15.

## M6 — Voice + Slack/Teams + GA (Weeks 16–20)

- [ ] Voice worker: Twilio inbound, Deepgram streaming STT, ElevenLabs streaming TTS, DTMF + SMS OTP.
- [ ] Voice latency target measured at <800ms first audio.
- [ ] Slack + Teams channels shipped.
- [ ] SOC2 Type I report delivered.
- [ ] Production GA: 3 design partners live + open self-serve signup with manual gating.

---

# Part 15 — Operational Runbooks

> Every runbook lives in `infra/runbooks/`. Each is a markdown file with the same template: Symptoms / Severity / Diagnosis steps / Mitigation / Postmortem template.

Required runbooks before GA:

1. **WhatsApp webhook outage** — symptoms: webhook 200-rate drop. Diagnosis: check Meta dashboard, check signature verification logs. Mitigation: queue inbound from internal retry buffer; notify tenants if >10 min.
2. **Voice call drops mid-conversation** — likely STT/TTS provider failure. Diagnosis: Deepgram/ElevenLabs status. Mitigation: failover to secondary provider (configured in `packages/voice-providers`).
3. **LLM provider outage (Anthropic down)** — `packages/llm` configured with secondary (OpenAI). Mitigation: flip env var `LLM_PROVIDER_FALLBACK=openai`, redeploy, monitor.
4. **Database connection pool exhausted** — symptoms: 500 spike on `/api/v1/*`. Mitigation: scale up API replicas; investigate slow query via pg_stat_statements.
5. **BullMQ queue depth alert** — diagnosis: identify slow consumer. Mitigation: scale consumer replicas; if stuck job, mark failed via Bull dashboard.
6. **Tenant secret rotation failure** — symptoms: SaaS API 401 errors for a tenant. Mitigation: admin re-enters credentials via channel/spec settings.
7. **Magic link delivery failure** — symptoms: drop in verification completion rate. Diagnosis: WhatsApp template approval status, BSP rate limits. Mitigation: contact BSP, fallback to SMS for affected users.
8. **Mass session revocation (security incident)** — invoke `POST /internal/security/revoke-all-sessions/:tenantId`. Audit log entry mandatory.
9. **Eval runner timeout** — diagnosis: which scenario? LLM provider latency? Mitigation: per-scenario timeout enforced at 5 minutes.
10. **Onboarding stuck (spec ingestion failure)** — symptoms: ingestion job stuck in queue. Diagnosis: check spec content for malformed YAML; retry job via Bull dashboard.

---

# Part 16 — Global Definition of Done

> A release is GA-ready only when every item below is checked.

## Code & Quality

- [ ] All Definition of Done sections from Parts 3–8 are checked (every layer DoD passes).
- [ ] CI is green on `main`: type check, lint, unit, integration, security scan, build, all pass.
- [ ] Test coverage ≥80% across `packages/*` and `apps/*` (excluding generated code).
- [ ] All cross-layer scenarios A–D (Part 10) pass against staging.
- [ ] Load tests (Part 10.4) pass against staging weekly.

## Documentation

- [ ] `README.md` at repo root documents setup, env, commands.
- [ ] Per-app README in each `apps/*` and `packages/*`.
- [ ] All 10 operational runbooks (Part 15) checked into `infra/runbooks/`.
- [ ] Public docs site (`docs.{domain}`) covers: onboarding, API reference, webhook signatures, security/compliance.

## Infrastructure

- [ ] Terraform applied to staging + prod regions (us-east-1, eu-west-1, ap-south-1).
- [ ] EKS clusters running, ArgoCD deploying from main.
- [ ] All five apps deployed in staging and prod.
- [ ] Multi-region failover tested manually once.
- [ ] DR runbook drilled once before GA.

## Observability

- [ ] Datadog dashboards: per-app SLI, per-tenant volume, LLM cost, voice latency.
- [ ] Langfuse capturing 100% of LLM calls.
- [ ] All alerts in §13.1 configured.
- [ ] PagerDuty rotations defined for SRE oncall.

## Security & Compliance

- [ ] All secrets in AWS Secrets Manager. No `.env` files in repo.
- [ ] Tenant credentials envelope-encrypted via KMS, verified via spot check.
- [ ] mTLS enabled between internal services.
- [ ] WAF deployed in front of ALB.
- [ ] SOC2 Type I report delivered.
- [ ] GDPR DPA published, DSAR + erasure endpoints tested.
- [ ] Penetration test scheduled or completed.

## Product

- [ ] Self-serve onboarding completable in <30 min by a non-CSM admin.
- [ ] At least 3 design partners live in production.
- [ ] Billing wired via Stripe (or equivalent), invoices generated correctly.
- [ ] Status page (`status.{domain}`) live, automated incident posting.

## Sign-off

- [ ] Engineering: lead engineer sign-off on each layer DoD.
- [ ] Security: CSO/CTO sign-off on §13.2 controls.
- [ ] Compliance: SOC2 auditor sign-off on Type I.
- [ ] Product: founder sign-off on product surface.
- [ ] Legal: DPA, ToS, Privacy Policy reviewed.

---

# Appendix A — Glossary

- **Action Definition** — Policy-enriched normalized representation of a single SaaS API endpoint that the LLM can invoke as a tool.
- **Auth proxy** — The component that calls the SaaS API using the end-user's own scoped token (not a master key).
- **Behavior Bundle** — Per-state configuration: persona, tone, allowed actions, KB scope, response constraints. Applied when a user is in that lifecycle state.
- **BYOK** — Bring Your Own (LLM API) Key. Tenant supplies their LLM provider key; we use it for their workload.
- **Cross-channel stitching** — Linking a new channel identifier to an existing identity without re-verifying when trust signals match (e.g. same phone, SaaS-provided web session token).
- **Fallback ladder** — Ordered recovery strategies when the bot fails to understand or act. Each strategy is tried in order with a max attempts cap.
- **Identity** — The binding between a channel identifier (phone, Slack ID) and a real person in the SaaS system.
- **Magic link** — Time-bound single-use URL used for first-touch identity verification on non-voice channels.
- **MCP** — Model Context Protocol; an emerging standard for LLM-to-tool integration. We accept MCP servers as a spec format.
- **Pipeline gate** — One of the 7 sequential checks in `PolicyService.executeAction` that every tool call passes through.
- **Playbook** — Per-tenant configuration of lifecycle states, behavior bundles, triggers, and fallback ladder. The "behavior moat."
- **Policy layer** — Layer 5; encompasses spec ingestion, action definitions, four-tier safety model. The "capability moat."
- **Risk tier** — 0 (Read) / 1 (Reversible Write) / 2 (State Update) / 3 (Destructive or Financial). Determines confirmation and step-up requirements.
- **Session** — Time-bounded window during which a verified identity can act without re-proving identity. Stored in Redis with rolling TTL.
- **Shadow deployment** — Running a new playbook version in parallel with active, logging outputs without sending to users. For comparison.
- **State inference** — Continuous classification of user lifecycle state from conversation signals + action history + SaaS context.
- **Step-up auth** — Additional re-verification (fresh magic link) required for Tier 3 actions even within an active session.
- **TOCTOU** — Time-of-check-to-time-of-use. Class of race condition prevented by locking args at confirmation time, not execution time.
- **Trigger** — Event-condition-action rule that fires during a turn to transition state, escalate, invoke an action, etc.

---

# Appendix B — Reading order for Claude Code

When Claude Code or any engineer is consuming this manual:

1. Read **Part 0** (top of file) for orientation.
2. Read **Part 1** (Product Overview) to understand the product.
3. Read **Part 2** (Repo Bootstrapping) and execute it to scaffold the repo.
4. Read **Part 3 (Layer 1)** in full. Build it. Run tests. Verify DoD.
5. Read **Part 4 (Layer 2)**. Build it. Verify DoD.
6. Continue layer-by-layer through Parts 5, 6, 7, 8 — never skip ahead; each layer depends on the previous.
7. At any layer, also read the corresponding sections of **Part 10** (cross-layer testing) and add the relevant integration tests.
8. After Layer 6 is complete, read **Part 9** (UI specs) when the HTML files arrive, and execute the styling/component instructions there.
9. Read **Parts 11–13** (per-app spec, infrastructure, observability) at any time — they're independent.
10. Use **Parts 14–16** (milestones, runbooks, global DoD) as the running release checklist.

---

*End of BUILD_MANUAL.md*
