import { ChannelType } from '@aelio/types';
import type { InboundContext } from '../agent/runtime.js';

/**
 * Layer 2 — normalize provider-specific payloads into the single internal shape
 * the runtime consumes. The channel layer is stateless w.r.t. conversation
 * logic: it routes messages in/out, it does not decide what to say.
 */

export interface NormalizedInbound extends InboundContext {
  externalId: string;
}

/** WhatsApp Cloud API webhook → normalized inbound (text messages only here). */
export function normalizeWhatsApp(tenantId: string, body: unknown): NormalizedInbound[] {
  const out: NormalizedInbound[] = [];
  const payload = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ id: string; from: string; text?: { body: string }; type: string }>;
        };
      }>;
    }>;
  };
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type !== 'text' || !msg.text) continue;
        out.push({
          externalId: msg.id,
          tenantId,
          channelType: ChannelType.WhatsApp,
          identifier: msg.from,
          text: msg.text.body,
        });
      }
    }
  }
  return out;
}

/** Web chat client message → normalized inbound. */
export function normalizeWebChat(
  tenantId: string,
  widgetSessionId: string,
  text: string,
): NormalizedInbound {
  return {
    externalId: `web_${widgetSessionId}_${Date.now()}`,
    tenantId,
    channelType: ChannelType.WebChat,
    identifier: widgetSessionId,
    text,
  };
}

/** Twilio voice transcript → normalized inbound (ANI is the identifier; enables stitching). */
export function normalizeVoiceTranscript(
  tenantId: string,
  from: string,
  transcript: string,
  callSid: string,
): NormalizedInbound {
  return {
    externalId: `${callSid}_${Date.now()}`,
    tenantId,
    channelType: ChannelType.Voice,
    identifier: from,
    text: transcript,
  };
}
