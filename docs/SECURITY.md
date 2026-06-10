# Security & compliance posture

Maps to the build manual Part 13. What is enforced in this build vs. what the
production deployment adds.

## Tenant isolation (enforced)
Every domain query in `apps/api/src/store/store.ts` filters on `tenantId`; there
is no cross-tenant read path. Redis-like keys are tenant-namespaced. The Drizzle
schema (`packages/db`) carries `tenant_id` on every domain table.

## Encryption (enforced)
- Secrets at rest are encrypted with **AES-256-GCM** envelope encryption in
  `@aelio/crypto` (random IV per call, GCM auth tag, `keyVersion` for rotation).
  Tenant SaaS tokens and channel credentials are stored only as ciphertext.
- Tokens (magic link, step-up, confirmation, session) are **HMAC-signed** and
  expiry-checked; signatures are compared in constant time.
- Production swaps the master key for **AWS KMS** envelope encryption (per-record
  data keys). No master key in env in staging/prod.

## The capability moat (enforced)
- Every SaaS call goes through the **auth proxy** using the **end user's own
  scoped token** — never a platform master key (`apps/api/src/policy/auth-proxy.ts`).
- The **seven policy gates** (`policy-service.ts`) enforce exposure, permissions,
  schema, constraints, pre-conditions, per-user rate limits, **tier confirmation
  (TOCTOU-locked args)**, and **step-up** for Tier 3.

## Prompt-injection defense (enforced + tested)
The system prompt is structurally separated from user input, and — critically —
**tool execution always passes through the policy gates**, so a successful
injection cannot bypass them: a Tier-3 action still requires confirmation + step-up
even if the model is coaxed into calling it. Covered by an eval scenario
("Prompt injection cannot bypass the policy gates") and a unit test in
`agent/runtime.test.ts`.

## Audit (enforced)
`audit_events` and `action_invocations` are **append-only** — no update/delete
methods exist on the store, and the Drizzle migration
`packages/db/migrations/0001_audit_immutability.sql` installs DB triggers that
reject UPDATE/DELETE. Every gate decision and action invocation is recorded.

## Secret masking (enforced)
Channel credential fields are masked (`••••••••ABCD`, last 4 shown) in every API
response (`maskSecret`, applied in `routes/api.ts` and `routes/admin.ts`).

## GDPR (enforced)
- **DSAR**: `POST /api/v1/t/:slug/settings/compliance/dsar` returns the user's
  identity, conversations, and facts.
- **Right to erasure**: `POST .../compliance/erasure` deletes the identity,
  channels, conversations, turns, and long-term facts; audit events retain a
  hashed reference only (append-only).
- Data residency is pinned per tenant (`region`).

## Service-to-service auth (enforced)
The worker→api `/internal/*` mesh requires the shared `INTERNAL_SERVICE_SECRET`
header. Provider webhooks verify signatures: **Meta `X-Hub-Signature-256`** and
**Slack v0** HMAC in `apps/channel-worker/src/providers.ts`.

## Added by the production deployment (infra/)
TLS 1.3 + mTLS between services, AWS WAF (OWASP CRS + webhook rate-limiting),
NetworkPolicy segmentation, Secrets Manager rotation, Snyk/Trivy scanning, SOC2
(Vanta) — see `infra/terraform`, `infra/k8s`, and `infra/runbooks`.
