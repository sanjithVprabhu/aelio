export interface ConvoxWebhookEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

/** Fire-and-forget POST of a Convox push_event to a customer webhook URL. */
export function postConvoxWebhook(
  webhookUrl: string,
  event: ConvoxWebhookEvent,
  fetchImpl: typeof fetch = fetch,
): void {
  void fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: event.eventType,
      payload: event.payload,
    }),
  }).catch(() => {
    /* delivery best-effort */
  });
}