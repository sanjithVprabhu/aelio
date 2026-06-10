import type { BusinessHours } from '@aelio/types';
import type { Kv } from '../store/kv.js';

/** True if `now` falls within one of the channel's configured open windows. */
export function isWithinBusinessHours(hours: BusinessHours | undefined, now = new Date()): boolean {
  if (!hours) return true; // 24/7 when unconfigured
  const day = now.getUTCDay();
  const windows = hours.days[day] ?? [];
  if (windows.length === 0) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return windows.some((w) => {
    const [oh, om] = w.open.split(':').map(Number);
    const [ch, cm] = w.close.split(':').map(Number);
    return minutes >= oh! * 60 + om! && minutes <= ch! * 60 + cm!;
  });
}

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp's 24-hour customer-service window: free-form sends require a recent inbound. */
export async function isWithin24hWindow(kv: Kv, tenantId: string, identifier: string): Promise<boolean> {
  const last = await kv.get<number>(`wa_last_inbound:${tenantId}:${identifier}`);
  return !!last && Date.now() - last < WHATSAPP_WINDOW_MS;
}

export async function markInbound(kv: Kv, tenantId: string, identifier: string): Promise<void> {
  await kv.set(`wa_last_inbound:${tenantId}:${identifier}`, Date.now(), 25 * 60 * 60);
}

/** Sliding-window inbound rate limit (manual default 10/user/min). Returns true if allowed. */
export async function checkInboundRateLimit(
  kv: Kv,
  tenantId: string,
  identifier: string,
  maxPerMinute = 10,
): Promise<boolean> {
  const key = `ratelimit:inbound:${tenantId}:${identifier}`;
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, 60);
  return count <= maxPerMinute;
}

/** Deduplicate by provider message id within a TTL. Returns true if already seen. */
export async function alreadyProcessed(kv: Kv, externalId: string): Promise<boolean> {
  const fresh = await kv.setNx(`msg_seen:${externalId}`, 1, 24 * 60 * 60);
  return !fresh;
}
