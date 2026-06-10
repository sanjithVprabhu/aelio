# Runbook: Disaster Recovery (DR)

Per **BUILD_MANUAL §12.5**. This is the documented DR plan and drill procedure.

## Targets

| Objective | Target | How it's met |
|---|---|---|
| **RPO** (max data loss) | **5 minutes** | Continuous Postgres WAL shipping (PITR) + S3 versioning (§12.5). |
| **RTO** (max downtime) | **1 hour** | Warm standby in a secondary AZ (Multi-AZ RDS). Cross-region failover requires **manual cutover** and is a **V2** feature. |

## Backup posture (§12.5)

- **Postgres:** PITR enabled, **35-day** retention. Multi-AZ primary with a warm
  standby in a secondary AZ. 2 read replicas.
- **S3:** Versioning enabled on all tenant-data buckets. **Cross-region
  replication** for `exports-` and `recordings-` buckets.
- **Redis (ElastiCache):** daily snapshots (working state; treated as
  reconstructable, not the source of truth).
- **Region isolation:** each region is a fully isolated deployment; there is no
  cross-region runtime data flow — only async backups/replication (§12.1).

## Severity
Any event triggering DR is **SEV-1** with an incident commander.

## Scenarios & procedures

### 1. AZ failure / primary DB instance loss (in-region) — covered by RTO 1h
1. Confirm the primary is unhealthy (RDS events, CloudWatch).
2. **Multi-AZ automatic failover** promotes the standby in the secondary AZ —
   verify it completed (new writer endpoint). DNS for the RDS endpoint updates
   automatically; app reconnects via the connection pool (roll api pods if
   connections are wedged).
3. Verify `/healthz` `{db, redis, queue}` is green and writes succeed.
4. Re-point/rebuild read replicas if they were lost.

### 2. Data corruption / bad migration / accidental deletion — covered by RPO 5m
1. Stop writes to the affected path (feature-flag or scale the writer down).
2. **Point-in-time restore** Postgres to just before the corrupting event
   (within the 35-day window). Restore to a new instance, validate, then cut the
   app over to it.
3. For S3 object loss/overwrite, restore the prior **object version** (versioning
   is on); for `exports-`/`recordings-` the cross-region replica is also available.
4. Reconcile Redis-derived state (sessions, rate limits) — these rebuild on
   demand; no restore needed.

### 3. Full region loss — MANUAL cross-region cutover (V2)
> Cross-region failover is **not automatic** (§12.5) and is a deliberate,
> commander-led cutover. Each region is isolated, so this is a data-residency-
> sensitive operation.
1. Declare the incident; assemble IC + Security + Compliance (residency).
2. Stand up / scale the target region's stack (Terraform env already applied).
3. Promote/restore Postgres in the target region from the latest shipped
   backups; restore S3 from cross-region replicas (`exports-`/`recordings-`).
4. Repoint Route53 (latency/failover records) to the target region's ALB.
5. Validate end-to-end (auth, a webhook, a Tier 0 action), then announce.
6. **Residency note:** only fail a region's data into a region permitted by that
   tenant's residency lock (§13.3). Audit any cross-region access.

## Escalation
- **SRE on-call + incident commander** for any DR event.
- **Compliance/Legal** for cross-region cutovers (data residency, GDPR).
- Cloud provider (AWS) enterprise support for region-wide events.

## Quarterly DR drill (§12.5)
Run at least once per quarter (and once before GA, §Part 16):
1. Pick a scenario (rotate: AZ failover, PITR restore, region cutover tabletop).
2. Execute against **staging** (or an isolated restore), timing each step.
3. Record measured **RPO** (data-loss window) and **RTO** (time-to-recover);
   compare against the 5-min / 1-hr targets.
4. File gaps as action items; update this runbook.

## Postmortem
For any real DR event, use the shared postmortem template (`README.md`). Capture
measured RPO/RTO vs. target, what automation gaps forced manual steps, and
residency/compliance implications of any cross-region action.
