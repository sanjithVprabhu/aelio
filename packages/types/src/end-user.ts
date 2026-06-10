import type { ChannelType } from './channel.js';

export enum VerificationStatus {
  Unverified = 'unverified',
  PendingMagicLink = 'pending_magic_link',
  PendingOtp = 'pending_otp',
  Verified = 'verified',
}

export interface IdentityChannel {
  id: string;
  identityId: string;
  tenantId: string;
  channelType: ChannelType;
  identifier: string;
  trusted: boolean;
  linkedAt: Date;
  lastSeenAt: Date;
}

export interface EndUserIdentity {
  id: string;
  tenantId: string;
  externalUserId: string;
  verificationStatus: VerificationStatus;
  verifiedAt?: Date;
  verificationChannel?: ChannelType;
  channels: IdentityChannel[];
  /** SaaS user's scoped access token, encrypted via @aelio/crypto. */
  encryptedAccessToken?: string;
  tokenExpiresAt?: Date;
  /** Inferred lifecycle state, e.g. 'early_user', 'at_risk'. */
  currentUserState: string;
  stateInferredAt: Date;
  stateConfidence: number; // 0..1
  contextCachedAt?: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EndUserSession {
  id: string;
  identityId: string;
  tenantId: string;
  token: string;
  channels: ChannelType[];
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  stepUpCompletedAt?: Date;
  stepUpExpiresAt?: Date;
  metadata: Record<string, unknown>;
}

export interface UserContext {
  externalUserId: string;
  tenantName?: string;
  displayName?: string;
  email?: string;
  plan?: string;
  accountCreatedAt?: string;
  lastLoginAt?: string;
  permissions?: string[];
  metadata: Record<string, unknown>;
}
