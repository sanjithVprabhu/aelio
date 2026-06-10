import type { ChannelType } from './channel.js';

export interface ChannelEndpoint {
  identifier: string;
  displayName?: string;
}

export type InboundContent =
  | { type: 'text'; text: string }
  | { type: 'voice_note'; audioUrl: string; mimeType: string; durationMs: number }
  | { type: 'voice_call'; callSid: string; from: string; to: string }
  | { type: 'image'; imageUrl: string; caption?: string }
  | { type: 'document'; documentUrl: string; filename: string; mimeType: string }
  | { type: 'interactive_reply'; buttonId: string; buttonText: string }
  | { type: 'dtmf'; digits: string }
  | { type: 'unsupported'; rawType: string };

export interface InboundMessage {
  id: string;
  externalId: string;
  tenantId: string;
  channelType: ChannelType;
  channelId: string;
  from: ChannelEndpoint;
  receivedAt: Date;
  content: InboundContent;
  raw: Record<string, unknown>;
}

export interface QuickReplyButton {
  id: string;
  text: string; // max 20 chars for WhatsApp
}

export type OutboundContent =
  | { type: 'text'; text: string }
  | { type: 'text_with_buttons'; text: string; buttons: QuickReplyButton[] }
  | { type: 'voice_speak'; ssml: string }
  | { type: 'voice_gather'; ssml: string; inputType: 'dtmf' | 'speech' | 'both' }
  | { type: 'voice_hangup'; ssml?: string }
  | { type: 'image'; imageUrl: string; caption?: string }
  | { type: 'magic_link'; text: string; url: string };

export interface OutboundMessage {
  tenantId: string;
  channelType: ChannelType;
  channelId: string;
  to: ChannelEndpoint;
  content: OutboundContent;
  conversationId: string;
  metadata?: Record<string, unknown>;
}
