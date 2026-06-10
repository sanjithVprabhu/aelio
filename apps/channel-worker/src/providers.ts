import { createHmac, timingSafeEqual } from 'node:crypto';
import { createLogger } from '@aelio/logger';
import type { ChannelType } from '@aelio/types';

const log = createLogger({ channelType: 'channel-worker' });

/** Verify an `X-Hub-Signature-256` from Meta (WhatsApp). */
export function verifyMetaSignature(signature: string | undefined, rawBody: string, appSecret: string): boolean {
  if (!appSecret) return true; // dev: no secret configured → accept
  if (!signature) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify a Slack request signature (v0). */
export function verifySlackSignature(
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
  signingSecret: string,
): boolean {
  if (!signingSecret) return true;
  if (!signature || !timestamp) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OutboundReply {
  kind: 'text' | 'magic_link' | 'step_up' | 'handoff';
  text: string;
  url?: string;
}

/**
 * Outbound delivery providers. In production these call Meta / Twilio / Slack.
 * The mock providers record + log delivery so the whole inbound→outbound loop
 * runs offline. The `delivered` log is the verifiable side-effect.
 */
export interface OutboundProvider {
  readonly channel: ChannelType;
  deliver(to: string, replies: OutboundReply[]): Promise<void>;
}

export class MockOutboundProvider implements OutboundProvider {
  readonly delivered: Array<{ to: string; text: string }> = [];
  constructor(public readonly channel: ChannelType) {}
  async deliver(to: string, replies: OutboundReply[]): Promise<void> {
    for (const r of replies) {
      this.delivered.push({ to, text: r.text });
      log.info({ channel: this.channel, to, kind: r.kind }, `delivered → ${r.text.slice(0, 80)}`);
    }
  }
}

/** Real WhatsApp delivery via the Meta Cloud API (Graph). */
export class MetaWhatsAppProvider implements OutboundProvider {
  readonly channel = 'whatsapp' as ChannelType;
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}
  async deliver(to: string, replies: OutboundReply[]): Promise<void> {
    for (const r of replies) {
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: r.text } }),
      });
      if (!res.ok) log.error({ status: res.status }, 'whatsapp send failed');
    }
  }
}

/** Real SMS delivery via the Twilio Messages API. */
export class TwilioSmsProvider implements OutboundProvider {
  readonly channel = 'sms' as ChannelType;
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}
  async deliver(to: string, replies: OutboundReply[]): Promise<void> {
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    for (const r of replies) {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: this.from, To: to, Body: r.text }).toString(),
        },
      );
      if (!res.ok) log.error({ status: res.status }, 'sms send failed');
    }
  }
}

/** Real Slack delivery via chat.postMessage. */
export class SlackProvider implements OutboundProvider {
  readonly channel = 'slack' as ChannelType;
  constructor(private readonly botToken: string) {}
  async deliver(to: string, replies: OutboundReply[]): Promise<void> {
    for (const r of replies) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.botToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ channel: to, text: r.text }),
      });
      if (!res.ok) log.error({ status: res.status }, 'slack send failed');
    }
  }
}

/** Choose a real provider when credentials are present, else the mock. */
export function selectProviders(): {
  whatsapp: OutboundProvider;
  sms: OutboundProvider;
  slack: OutboundProvider;
} {
  const env = process.env;
  const whatsapp =
    env.META_PHONE_NUMBER_ID && env.META_ACCESS_TOKEN
      ? new MetaWhatsAppProvider(env.META_PHONE_NUMBER_ID, env.META_ACCESS_TOKEN)
      : new MockOutboundProvider('whatsapp' as ChannelType);
  const sms =
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SMS_FROM
      ? new TwilioSmsProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_SMS_FROM)
      : new MockOutboundProvider('sms' as ChannelType);
  const slack = env.SLACK_BOT_TOKEN
    ? new SlackProvider(env.SLACK_BOT_TOKEN)
    : new MockOutboundProvider('slack' as ChannelType);
  return { whatsapp, sms, slack };
}
