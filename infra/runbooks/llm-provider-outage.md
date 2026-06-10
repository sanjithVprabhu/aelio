# Runbook: LLM Provider Outage (Anthropic down)

## Symptom / Alert
- **Alert:** "LLM provider error rate > 5%" → PagerDuty (auto-fallback to
  secondary if configured) (§13.1).
- Agent runtime turns fail or stall; conversations stop progressing.
- Langfuse shows a spike in failed/timed-out LLM calls (`packages/llm`).

The primary provider is **Anthropic (Claude)** — the default model is
`claude-opus-4-8`. The configured secondary is **OpenAI** (§Part 15.3).

## Severity
**SEV-1** if the primary provider is fully down and fallback is not active;
**SEV-2** if fallback is already absorbing traffic.

## Diagnosis steps
1. Check **status.anthropic.com** for a primary-provider incident. Distinguish a
   provider outage from a key/quota problem:
   - 401/403 from the provider → credential/permission issue, not an outage.
   - 429 → rate-limit/quota, not an outage (raise limits or shed load).
   - 500/503/529 (overloaded) → genuine provider degradation; fail over.
2. In Langfuse, confirm whether failures are concentrated on the primary
   provider or span both (the latter suggests a bug in `packages/llm`, not the
   provider).
3. Check whether BYOK tenants are affected differently — a tenant-supplied key
   failing is a per-tenant issue (see tenant-secret-rotation-failure).

## Mitigation steps
1. **Flip to the secondary provider.** Set the env var
   `LLM_PROVIDER_FALLBACK=openai`, redeploy the affected workloads (api,
   eval-runner), and monitor recovery (§Part 15.3). If auto-fallback is enabled,
   confirm it has already engaged before manual action.
2. Validate the secondary's model mapping in `packages/llm` (the fallback model
   must be wired and have quota). Watch error rate and P95 latency.
3. If the issue is a 429 on the primary (not an outage), prefer raising limits or
   shedding non-critical load (e.g. pausing eval-runner jobs) over failing over.
4. Once the primary recovers, revert `LLM_PROVIDER_FALLBACK` and redeploy during
   a low-traffic window; confirm Langfuse error rate returns to baseline.

## Escalation
- Page **Agent Runtime / SRE on-call**.
- Open a priority support ticket with the affected LLM provider.
- For SEV-1, assign an incident commander and post to the status page.

## Postmortem
Record: time-to-fallback, whether fallback was automatic, any conversations lost
vs. degraded, and quota headroom on the secondary. Action items: verify the
auto-fallback trigger fired, and add an eval case if the fallback path produced
materially different behavior.
