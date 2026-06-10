# Runbook: Eval Runner Timeout

## Symptom / Alert
- **Symptom:** an eval run (Kubernetes Job spawned by apps/api) does not
  complete; scenarios hang or the run is killed on timeout (§Part 15.9).
- `eval_runs.results` not written, or partial; admin Evals screen shows the run
  stuck/failed.

## Severity
**SEV-3** — eval-runner is offline/batch and does **not** affect live
conversations (§Part 11.5). Escalate only if it blocks a release gate.

## Diagnosis steps
1. **Which scenario?** (§Part 15.9) Identify the specific scenario(s) that hung
   from the run logs. A single slow scenario vs. all scenarios narrows the cause.
2. **LLM provider latency?** (§Part 15.9) Check Langfuse for elevated LLM call
   latency during the run — provider slowness is the most common cause (see
   llm-provider-outage if widespread).
3. Check the eval sandbox DB (`EVAL_SANDBOX_DATABASE_URL`) — a slow/locked
   sandbox can stall replay.
4. Check the per-tenant **concurrency limit** (default 3, §11.5) — runs may be
   queued behind others, not actually hung.

## Mitigation steps
1. **Per-scenario timeout is enforced at 5 minutes** (§Part 15.9): confirm the
   runner is honoring it so one bad scenario can't hang the whole suite; a
   timed-out scenario should be marked failed and the run should continue.
2. If provider latency is the cause, retry the run once the provider recovers, or
   point the runner at the secondary provider (`LLM_PROVIDER_FALLBACK`).
3. If a specific scenario is pathological (infinite tool loop, huge fixture),
   quarantine it and file a fix; re-run the rest of the suite.
4. Clean up the stuck Kubernetes Job (it should be `ttlSecondsAfterFinished`-
   reaped, but delete manually if wedged) and re-trigger from apps/api.

## Escalation
- Route to the **Evals / Agent Runtime** owner.
- Page **SRE on-call** only if eval-runner Jobs are failing to schedule at all
  (cluster/capacity issue on the general node pool).

## Postmortem
Record the offending scenario(s), whether the 5-minute per-scenario timeout
fired correctly, and provider latency at the time. Action items: ensure timeouts
are enforced, add a scenario-duration metric, and quarantine flaky scenarios.
