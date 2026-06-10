# Runbook: WhatsApp Webhook Outage

## Symptom / Alert
- **Alert:** "Webhook 200-rate < 99% for 10 min" → PagerDuty (§13.1).
- Inbound WhatsApp messages stop creating conversations / turns.
- Spike in 4xx/5xx on `POST /webhooks/whatsapp/:slug` (apps/api) or the
  channel-worker low-latency path.
- Tenants report "bot not responding on WhatsApp."

## Severity
**SEV-2** (single channel degraded). Escalate to **SEV-1** if it affects all
tenants or persists > 30 min.

## Diagnosis steps
1. Confirm scope in Datadog: is the 200-rate drop one tenant slug or all?
   - One slug → tenant/BSP config issue. All → platform-side.
2. Check **Meta / WhatsApp Cloud API status** (developers.facebook.com/status
   and the Meta Business dashboard) for an upstream outage.
3. Check **signature verification logs**: search logs for
   `whatsapp signature mismatch` / `X-Hub-Signature-256`. A wave of mismatches
   means `META_APP_SECRET` is stale/rotated (see secret-rotation runbook).
4. Verify the webhook callback URL + verify-token are still registered in the
   Meta app config (someone may have changed the public hostname/ALB).
5. Check ALB / WAF: is the `webhook-rate-limit` WAF rule blocking legitimate
   traffic? Inspect WAF sampled requests for `BLOCK` on `/webhooks/`.
6. Check api / channel-worker pod health and `BullMQ` inbound queue depth.

## Mitigation steps
1. **If upstream (Meta) outage:** nothing to fix our side. Meta retries webhook
   deliveries; our handler is idempotent. Post status, monitor.
2. **If signature mismatch (stale secret):** restore the correct
   `META_APP_SECRET` in Secrets Manager; let External Secrets resync; roll the
   affected pods.
3. **If WAF false-positive:** raise `webhook_rate_limit` (shared/waf) or add a
   scoped allow for the tenant; re-apply WAF.
4. **Buffer inbound:** the handler enqueues accepted inbound events to an
   internal retry buffer; confirm the buffer is draining once the path recovers.
   Replay any dead-lettered inbound events from the Bull dashboard.
5. **If > 10 min:** notify affected tenants (status page + targeted email) that
   WhatsApp delivery is delayed and being recovered.

## Escalation
- Page **Channels on-call** first.
- If Meta-side: open a Meta Business support ticket; loop in the BSP TAM.
- If platform-wide: escalate to **SRE on-call** + incident commander.

## Postmortem
Use the shared template in `README.md`. Capture: detection lag vs. the 10-min
alert window, whether the retry buffer fully recovered inbound, and any tenant
data loss (should be zero given buffering).
