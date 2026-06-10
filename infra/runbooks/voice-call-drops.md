# Runbook: Voice Call Drops Mid-Conversation

## Symptom / Alert
- **Alert:** "Voice first-audio latency P95 > 1s for 5 min" → PagerDuty, and/or
  a spike in dropped/aborted voice sessions.
- Callers experience silence, then disconnect, mid-conversation.
- Most likely cause: **STT (Deepgram) or TTS (ElevenLabs/Cartesia) provider
  failure** (§Part 15.2).

## Severity
**SEV-1** if a significant fraction of live calls drop; **SEV-2** for elevated
latency without mass drops.

## Diagnosis steps
1. Datadog voice-worker dashboard: active calls, mean first-audio latency,
   STT latency, TTS latency. Identify which leg (STT vs TTS) regressed.
2. Check provider status pages: **Deepgram** and **ElevenLabs / Cartesia**.
3. Check voice-worker pod health on the **voice node group** (tainted
   c6i.2xlarge). Look for OOM/CPU saturation — recall ~50 concurrent calls/pod
   ceiling (§11.4); a pod over capacity will drop calls.
4. Inspect logs for WebSocket disconnects between Twilio media stream and the
   pod (sticky-session/affinity loss → mid-call cutover, which is unsupported).
5. Check `DEEPGRAM_API_KEY` / `ELEVENLABS_API_KEY` validity (auth errors in
   logs → secret issue).

## Mitigation steps
1. **Provider failure → failover to secondary** configured in
   `packages/voice-providers`. Flip the provider selection (env/flag) and let
   new calls use the healthy provider. In-flight calls cannot fail over
   (no mid-call recording-replay until V2).
2. **Capacity saturation →** scale voice-worker. HPA scales on
   `voice_active_calls` (target ~40/pod); if it lagged, bump `minReplicas` or
   manually scale the Deployment. Ensure the voice node group has headroom
   (it autoscales 2–10 nodes).
3. **Affinity loss →** verify the voice-worker Service still has
   `sessionAffinity: ClientIP`; a bad rollout that dropped it will cut calls.
4. **Bad key →** restore the provider key in Secrets Manager, resync, roll pods.
5. Drain rollouts gracefully (preStop sleep) so future deploys don't drop calls.

## Escalation
- Page **Voice on-call** immediately (SEV-1).
- Provider-side: open Deepgram / ElevenLabs priority support.
- Loop in incident commander for SEV-1 + status page update.

## Postmortem
Quantify dropped calls and affected tenants. Note whether failover was
automatic or manual, and the gap between provider failure and our cutover.
Action item candidates: faster provider health-check, automated failover,
recording-replay (V2) to enable mid-call failover.
