# Runbook: Onboarding Stuck — Spec Ingestion Failure

## Symptom / Alert
- **Symptom:** onboarding is stuck — the **spec ingestion job is stuck in the
  queue** (§Part 15.10). The admin uploaded an OpenAPI / Postman / MCP spec but
  action definitions never get generated, so the playbook can't bootstrap.
- Onboarding wizard shows "processing" indefinitely.

## Severity
**SEV-3** (single tenant onboarding), but high-friction for a new design partner
— escalate to **SEV-2** if it blocks a scheduled go-live.

## Diagnosis steps
1. Locate the ingestion job on the **Bull dashboard**: is it `waiting` (consumer
   not picking up — see bullmq-queue-depth), `active` but wedged, or `failed`?
2. **Inspect the spec content for malformed YAML/JSON** (§Part 15.10) — the most
   common cause. Check the job's error for a parse/validation failure, an
   unsupported OpenAPI version, or an oversized spec.
3. Check whether downstream steps failed: action-definition generation, KB
   indexing, or playbook bootstrap (each is its own job/stage).
4. Confirm the ingestion consumer (api background worker) is healthy and not
   blocked behind a deep queue.

## Mitigation steps
1. **Malformed spec → fix + re-upload.** Return the precise parse error to the
   admin (line/field) so they can correct the spec, then re-upload. Do not retry
   a structurally invalid spec — it will fail again.
2. **Transient/stuck job → retry via the Bull dashboard** (§Part 15.10). If it's
   wedged in `active` past its lock, mark it failed and re-enqueue.
3. If the consumer is down or backlogged, recover/scale it (see
   bullmq-queue-depth) so the job can run.
4. After successful ingestion, verify action definitions exist and the playbook
   bootstrap completed; the end-to-end check is upload → bootstrap → a Tier 0
   action succeeds.

## Escalation
- Route to the **Policy layer (spec ingestion)** owner, plus **CSM** for the
  affected onboarding tenant.
- Page **SRE on-call** only if the ingestion consumer/queue is broadly down.

## Postmortem
Record the cause (malformed spec vs. stuck job vs. consumer down) and which stage
failed. Action items: surface spec-validation errors to the admin synchronously
at upload time (fail fast, before queueing), and add an ingestion-job
age/failure alert.
