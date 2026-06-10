# Runbook: Tenant Secret Rotation Failure

## Symptom / Alert
- **Symptom:** **SaaS API 401 errors for a specific tenant** (§Part 15.6) — the
  bot can authenticate but tool/action calls into the tenant's SaaS fail auth.
- May surface as a spike in Tier 0–3 action failures scoped to one tenant slug,
  or fallback-ladder triggers on actions.

## Severity
**SEV-3** (single tenant, self-serve fixable). Escalate to **SEV-2** if it
affects a design partner in production or multiple tenants (suggests a
platform-side rotation Lambda failure).

## Diagnosis steps
1. Confirm scope: one tenant or many? Many tenants 401-ing at once points at the
   **Secrets Manager quarterly rotation Lambda** (§13.2) failing, not a single
   tenant's expired credential.
2. Check the auth proxy / action invocation logs for the tenant: is the failure a
   401 from the SaaS (bad/expired credential) vs. a 403 (scope) vs. our
   envelope-decrypt error (KMS)?
3. If it's a KMS decrypt error, this is a **platform** issue (master key
   rotation re-encryption) — see dr.md / secret rotation, not the tenant.
4. Verify the tenant's stored credential in channel/spec settings is the one
   currently expected by their SaaS (they may have rotated it on their side).

## Mitigation steps
1. **Single tenant (expired/changed credential):** have the tenant admin
   **re-enter their credentials via channel/spec settings** (§Part 15.6). The new
   value is envelope-encrypted via KMS and takes effect immediately; no redeploy.
2. **Platform rotation Lambda failure:** re-run the rotation for the affected
   secret(s) in Secrets Manager; confirm the new version is staged and the app
   picks it up (External Secrets resync + pod roll if needed).
3. **KMS master-key re-encryption gap:** re-encrypt tenant BYOK/data keys against
   the current master key (§13.2 "re-encryptable on master key rotation").
4. Verify recovery by replaying a Tier 0 (read) action for the tenant.

## Escalation
- Single tenant: route to **CSM / Support** to coordinate the admin re-entry.
- Multi-tenant / rotation-Lambda / KMS: page **Security / SRE on-call**.

## Postmortem
Record whether it was a single-tenant credential change or a platform rotation
failure. Action items: alert on per-tenant action 401-rate, monitor rotation
Lambda success, and add a pre-expiry warning so credentials are refreshed before
they fail.
