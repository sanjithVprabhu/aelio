# Operational Runbooks

Per **BUILD_MANUAL Part 15**. Every runbook follows the same template:

> **Title / Symptom (alert) / Severity / Diagnosis steps / Mitigation steps /
> Escalation / Postmortem template.**

These are the required runbooks before GA (§Part 16 DoD):

| # | Runbook | File |
|---|---------|------|
| 1 | WhatsApp webhook outage | [whatsapp-webhook-outage.md](./whatsapp-webhook-outage.md) |
| 2 | Voice call drops mid-conversation | [voice-call-drops.md](./voice-call-drops.md) |
| 3 | LLM provider outage (Anthropic down) | [llm-provider-outage.md](./llm-provider-outage.md) |
| 4 | Database connection pool exhausted | [db-pool-exhausted.md](./db-pool-exhausted.md) |
| 5 | BullMQ queue depth alert | [bullmq-queue-depth.md](./bullmq-queue-depth.md) |
| 6 | Tenant secret rotation failure | [tenant-secret-rotation-failure.md](./tenant-secret-rotation-failure.md) |
| 7 | Magic link delivery failure | [magic-link-delivery-failure.md](./magic-link-delivery-failure.md) |
| 8 | Mass session revocation (security incident) | [mass-session-revocation.md](./mass-session-revocation.md) |
| 9 | Eval runner timeout | [eval-runner-timeout.md](./eval-runner-timeout.md) |
| 10 | Onboarding spec ingestion failure | [onboarding-spec-ingestion-failure.md](./onboarding-spec-ingestion-failure.md) |
| — | Disaster recovery (RPO 5 min / RTO 1 hr) | [dr.md](./dr.md) |

## On-call quick reference

- Alerts route to **PagerDuty** (high severity) or **Slack** (warnings) per §13.1.
- Observability: **Datadog** (APM/logs/metrics), **Langfuse** (LLM traces).
- Cluster access: `kubectl` against the affected region's EKS cluster, namespace
  `aelio`. Workloads: `api`, `admin`, `channel-worker`, `voice-worker`,
  `eval-runner` (Jobs).
- Never edit Kubernetes Secrets by hand — they are synced from AWS Secrets
  Manager via External Secrets.

## Postmortem template (shared)

```
# Postmortem: <incident title> (<date>)
- Severity / duration / customer impact:
- Detection: how + time-to-detect:
- Timeline (UTC):
- Root cause:
- Contributing factors:
- What went well / what didn't:
- Action items (owner, due date):
- Follow-up eval/alert/runbook changes:
```
