import type { ChannelType } from './channel.js';

export enum ConversationStatus {
  Active = 'active',
  WaitingForUser = 'waiting_for_user',
  WaitingForHuman = 'waiting_for_human',
  HandedOff = 'handed_off',
  Resolved = 'resolved',
  Abandoned = 'abandoned',
}

export type TurnContent =
  | { type: 'text'; text: string }
  | { type: 'voice_note'; audioUrl: string; transcript: string; durationMs: number }
  | { type: 'tool_call'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: unknown; success: boolean }
  | { type: 'handoff'; reason: string; escalationTicketId: string };

export interface Turn {
  id: string;
  conversationId: string;
  tenantId: string;
  role: 'user' | 'assistant' | 'system';
  content: TurnContent;
  channelType: ChannelType;
  modelUsed?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  /** Confidence/action metadata surfaced in the inbox. */
  meta?: Record<string, unknown>;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  tenantId: string;
  identityId: string;
  status: ConversationStatus;
  activeChannelType: ChannelType;
  channelId: string;
  playbookId: string;
  playbookVersion: string;
  userStateAtStart: string;
  currentUserState: string;
  metadata: Record<string, unknown>;
  startedAt: Date;
  lastActivityAt: Date;
  resolvedAt?: Date;
}

export interface Escalation {
  id: string;
  conversationId: string;
  tenantId: string;
  identityId: string;
  reason: string;
  priority: 'normal' | 'urgent';
  status: 'unassigned' | 'assigned' | 'resolved';
  assignedToId?: string;
  assignedToName?: string;
  claimedAt?: Date;
  resolvedAt?: Date;
  createdAt: Date;
}
