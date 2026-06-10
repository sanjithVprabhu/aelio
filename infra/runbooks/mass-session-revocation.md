# Runbook: Mass Session Revocation (Security Incident)

## Symptom / Alert
- **Trigger:** a security incident requiring all active sessions for a tenant to
  be invalidated immediately — suspected credential/session compromise, leaked
  token, or at a tenant's urgent request (§Part 15.8).
- This is an **action runbook**, not an alert: you invoke it deliberately.

## Severity
**SEV-1** by default (security incident). Treat with incident-response rigor.

## Diagnosis steps
1. Confirm the **blast radius**: one tenant or platform-wide? This runbook
   revokes per **tenant**; platform-wide revocation is a broader IR decision.
2. Establish **why** revocation is needed (compromise vs. precaution) and capture
   evidence before acting — note timestamps, affected identities, indicators.
3. Verify you have the correct `tenantId` (revoking the wrong tenant logs out all
   their users needlessly).

## Mitigation steps
1. **Invoke the internal endpoint** (§Part 15.8):
   `POST /internal/security/revoke-all-sessions/:tenantId`.
   This invalidates all Redis-backed sessions for the tenant; users must
   re-verify (magic link / step-up) on their next interaction.
2. **An audit log entry is mandatory** (§Part 15.8): the revocation writes to
   `audit_events` (immutable, RLS-scoped per §1.9) with actor, tenantId, reason,
   and time. Confirm the entry exists.
3. Rotate any implicated secrets (tenant credentials, internal service secret) if
   the incident involved credential exposure — coordinate with the
   tenant-secret-rotation runbook.
4. Notify the tenant per the incident-communication policy.

## Escalation
- This is a security incident: engage **Security on-call + incident commander**
  immediately.
- Involve **Legal/Compliance** if customer data exposure is suspected (GDPR
  breach-notification timelines may apply, §13.3).

## Postmortem
Mandatory security postmortem. Record: trigger, scope, exact revocation time,
audit-event ID, secrets rotated, and tenant communications. Action items:
detection improvements, and confirm revocation forced re-verification for every
affected identity.
