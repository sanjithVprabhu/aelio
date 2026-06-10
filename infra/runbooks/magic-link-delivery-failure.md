# Runbook: Magic Link Delivery Failure

## Symptom / Alert
- **Symptom:** a **drop in verification completion rate** (§Part 15.7) — users
  request identity verification but the magic link never arrives, so sessions
  aren't established.
- Concentrated on a channel (usually WhatsApp), or a tenant/BSP.

## Severity
**SEV-2** — blocks new identity verification (onboarding into conversations).
**SEV-1** if it affects all tenants on a channel.

## Diagnosis steps
1. Confirm the funnel in Datadog: links **generated** vs. **delivered** vs.
   **completed**. A generation drop is an api/issuer problem; a delivery drop is
   a channel/BSP problem; a completion drop with good delivery is a verify-page
   problem (`verify.{domain}`).
2. **WhatsApp template approval status** (§Part 15.7): is the verification
   template still approved by Meta? A paused/rejected template blocks delivery.
3. **BSP rate limits:** are we being throttled by the BSP? Check 429s / delivery
   receipts.
4. Check the verify page host (`verify.{domain}`) is up (api `/verify/:token`)
   and tokens aren't expiring before use (clock/TTL).

## Mitigation steps
1. **Template / BSP issue → contact the BSP** (§Part 15.7); request template
   re-approval or a rate-limit increase.
2. **Fallback to SMS for affected users** (§Part 15.7): route verification
   delivery to SMS (Twilio) for the impacted channel/tenant while WhatsApp
   recovers. Confirm SMS sender + opt-in compliance for the region.
3. If tokens are expiring too fast under delivery lag, extend the magic-link TTL
   temporarily.
4. If the verify page is down, treat as an api availability incident and recover
   the api workload.

## Escalation
- Page **Identity / Channels on-call**.
- Open a BSP support ticket for template/rate-limit issues; loop in the Meta TAM
  for template approvals.

## Postmortem
Capture where the funnel broke (generate / deliver / complete), whether SMS
fallback was used, and how many verifications were delayed vs. lost. Action
items: alert on delivery-rate per channel, pre-stage an approved SMS fallback
template, and monitor WhatsApp template status proactively.
