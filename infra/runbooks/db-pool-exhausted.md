# Runbook: Database Connection Pool Exhausted

## Symptom / Alert
- **Alert:** "Database connection pool > 80% utilized" → Slack (§13.1).
- Symptom: a **500 spike on `/api/v1/*`** (§Part 15.4), often with timeouts
  acquiring a connection.
- `/readyz` may flip unhealthy if it checks pool/queue saturation.

## Severity
**SEV-2** (degraded), escalating to **SEV-1** if the API is broadly returning
500s to end users / tenants.

## Diagnosis steps
1. Confirm in Datadog: is the spike correlated with a traffic surge, a slow
   query, or a connection leak (steadily climbing, never released)?
2. Check the RDS `DatabaseConnections` metric against `max_connections`
   (CloudWatch alarm `*-rds-connections-high`). Compare primary vs. read
   replicas — admin dashboard reads should hit replicas.
3. Identify slow queries via **pg_stat_statements** (enabled in the RDS
   parameter group). Look for missing indexes, full scans, or a runaway report.
4. Check for a deploy that changed pool size or query patterns just before onset.

## Mitigation steps
1. **Scale up API replicas** (HPA is 3–20; bump `minReplicas` or scale manually)
   so per-pod pool pressure drops — but only if the DB itself has connection
   headroom; otherwise this makes it worse.
2. **Kill the offending query/session** if a single slow query is saturating the
   pool: `SELECT pg_terminate_backend(pid)` for the culprit from
   pg_stat_activity. Then add the missing index / fix the query.
3. If reads are hitting the primary, route them to **read replicas**.
4. If connections are leaking, roll the API pods to reset the pool while the
   leak is patched.
5. As a last resort, raise RDS `max_connections` (parameter group) — but pair it
   with app pool sizing; uncontrolled growth just moves the bottleneck to RDS
   memory.

## Escalation
- Page **Backend / SRE on-call** if user-facing 500s persist after scaling.
- Loop in a DBA for query tuning / `max_connections` changes.

## Postmortem
Capture the root cause (surge vs. slow query vs. leak), the offending query plan,
and whether pool/replica routing was correct. Action items: add the index, add a
query-latency SLO alert, and right-size the per-pod pool against
`max_connections`.
