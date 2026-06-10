# Runbook: BullMQ Queue Depth Alert

## Symptom / Alert
- **Alert:** "BullMQ queue depth > 10000" → Slack (§13.1).
- Background jobs (spec ingestion, playbook bootstrap, KB indexing, DSAR
  exports) lag; users see "processing" states that don't complete.

## Severity
**SEV-3** for transient backlog that is draining; **SEV-2** if a critical queue
(e.g. spec ingestion blocking onboarding) is stuck and growing.

## Diagnosis steps
1. Identify **which queue** is deep (Bull dashboard / Redis). Depth on one queue
   vs. all queues points to a single slow consumer vs. a Redis-wide problem.
2. Check the **consumer**: are workers running and healthy (api / channel-worker
   /eval-runner pods)? Is throughput near zero (stuck) or just slower than
   arrival (under-provisioned)?
3. Look for a **stuck/poison job**: a job repeatedly failing and retrying, or one
   wedged in `active` past its lock TTL. Inspect its data and error.
4. Check Redis health (ElastiCache): memory pressure, evictions
   (`maxmemory-policy` is `noeviction`, so writes should fail loudly rather than
   silently drop), CPU.

## Mitigation steps
1. **Scale consumer replicas** for the affected app (channel-worker HPA 3–10;
   api 3–20) to increase drain rate.
2. **Handle a stuck job:** if a single job is wedged, **mark it failed via the
   Bull dashboard** (§Part 15.5) so the queue advances; re-enqueue after fixing
   the root cause.
3. If a poison job is retry-looping, move it to the dead-letter set and stop its
   retries.
4. If Redis is the bottleneck (memory/CPU), check shard balance; scale the
   ElastiCache node type or shard count if sustained.

## Escalation
- Page **SRE on-call** if a critical queue stays stuck after scaling.
- Loop in the owning team (e.g. Policy layer for spec ingestion, Platform for KB
  indexing).

## Postmortem
Record which queue, root cause (slow consumer vs. stuck job vs. Redis), and drain
time. Action items: add per-queue depth + age SLOs, autoscale consumers on queue
depth, and add a poison-job guard (max attempts → DLQ).
