export enum ChannelType {
  WhatsApp = 'whatsapp',
  Voice = 'voice',
  WebChat = 'web_chat',
  SMS = 'sms',
  Slack = 'slack',
  Teams = 'teams',
}

export enum ChannelStatus {
  PendingVerification = 'pending_verification',
  Active = 'active',
  Suspended = 'suspended',
  Disconnected = 'disconnected',
}

export interface BusinessHours {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. Each entry is a list of open windows. */
  days: Record<number, Array<{ open: string; close: string }>>;
}

export interface WhatsAppChannelConfig {
  type: 'whatsapp';
  phoneNumberId: string;
  wabaId: string;
  accessToken: string; // encrypted at rest
  webhookVerifyToken: string;
}

export interface VoiceChannelConfig {
  type: 'voice';
  phoneNumber: string; // E.164
  provider: 'twilio' | 'telnyx';
  accountSid: string; // encrypted at rest
  authToken: string; // encrypted at rest
  inboundEnabled: boolean;
  outboundEnabled: boolean;
}

export interface WebChatChannelConfig {
  type: 'web_chat';
  widgetName: string;
  accentColor: string;
  allowedOrigins: string[];
}

export interface SlackChannelConfig {
  type: 'slack';
  teamId: string;
  botToken: string; // encrypted at rest
  signingSecret: string; // encrypted at rest
}

export type ChannelConfig =
  | WhatsAppChannelConfig
  | VoiceChannelConfig
  | WebChatChannelConfig
  | SlackChannelConfig;

export interface Channel {
  id: string;
  tenantId: string;
  type: ChannelType;
  status: ChannelStatus;
  config: ChannelConfig;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  businessHours?: BusinessHours;
  fallbackMessage: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChannelRateLimitConfig {
  maxInboundPerUserPerMinute: number; // default 10
  maxOutboundPerUserPerHour: number; // default 60
  maxConcurrentVoiceSessions: number; // default 5 per tenant
}
