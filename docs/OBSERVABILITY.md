# Observability

Maps to the build manual Part 13.1.

## Structured logging (enforced)
`@aelio/logger` emits one JSON object per line carrying bound context — `tenantId`,
`conversationId`, `identityId`, `traceId`, `spanId`, `channelType`. Every layer
binds its context via `.child()`. In production this stream goes stdout → Fluent
Bit → Datadog Logs unchanged.

## Tracing (enforced, lightweight)
`apps/api/src/util/trace.ts` provides W3C-style `traceId`/`spanId` generation and
a `withSpan()` timer that logs span start/end + duration. This mirrors the OTel
span shape so traces are correlatable; the production swap wires the OpenTelemetry
SDK exporting to Datadog APM (same field names).

## Per-turn telemetry (enforced)
`apps/api/src/agent/telemetry.ts` emits a `turn.completed` event for every turn:
model, token usage, tool-call results (with tier + success), KB chunks retrieved,
fallback triggered, triggers fired, escalation, latency, and whether the playbook
was an experiment. These feed the analytics surface
(`GET /api/v1/t/:slug/analytics`) and the dashboard.

## LLM tracing (implemented — Langfuse)
The `@aelio/llm` boundary is the single place every model call flows through.
`withObservability()` wraps any client and posts a generation trace to Langfuse's
ingestion API per call; `createLLMClient` attaches it automatically when
`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` are set (100% sampling, manual §13.1).
Tracing never blocks or breaks the request path. The scripted provider records the
same usage shape.

## Metrics & alerts (production)
Per-app SLI dashboards and the PagerDuty alert rules (P95 latency, error rate,
webhook 200-rate, LLM provider errors, queue depth, voice first-audio) are
defined as CloudWatch alarms in `infra/terraform/modules/observability` and the
runbooks in `infra/runbooks/`.
