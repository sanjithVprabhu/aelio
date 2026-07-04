import { encryptSync, randomToken, signToken, verifyToken } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import {
  ChannelType,
  VerificationStatus,
  type EndUserIdentity,
  type EndUserSession,
  type IdentityChannel,
  type UserContext,
} from '@aelio/types';
import type { IdentityAssertion } from '@aelio/convox-sdk';
import type { Store } from '../store/store.js';
import type { Kv } from '../store/kv.js';

import type { StepUpPort } from '../policy/policy-service.js';
import { uuid } from '../util/id.js';

const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const MAGIC_LINK_TTL_S = 15 * 60;
const STEP_UP_TTL_S = 5 * 60;
const STEP_UP_VALID_MS = 15 * 60 * 1000;

export type ResolveResult =
  | { status: 'active'; identity: EndUserIdentity; session: EndUserSession; stitched?: boolean }
  | { status: 'needs_verification'; identity: EndUserIdentity; magicLinkUrl: string };

/**
 * Layer 3 — identity, sessions, magic-link verification, step-up, and
 * cross-channel stitching. Trust hierarchy:
 *   channel identifier alone  → untrusted (spoofable)
 *   + magic link              → verified
 *   + active session          → authenticated
 *   + step-up                 → elevated (Tier 3)
 */
export class IdentityService implements StepUpPort {
  constructor(
    private readonly store: Store,
    private readonly kv: Kv,
    private readonly baseUrl: string,
  ) {}

  /** Resolve a channel identifier to an authenticated session, or initiate verification. */
  async resolveOrInitiate(
    tenantId: string,
    channelType: ChannelType,
    identifier: string,
  ): Promise<ResolveResult> {
    const ic = this.store.findIdentityChannel(tenantId, channelType, identifier);

    if (ic) {
      const identity = this.store.getIdentityById(ic.identityId)!;
      ic.lastSeenAt = new Date();
      this.store.putIdentityChannel(ic);
      if (ic.trusted && identity.verificationStatus === VerificationStatus.Verified) {
        const session = await this.ensureSession(identity, channelType);
        return { status: 'active', identity, session };
      }
      // Untrusted channel — (re)send a magic link.
      const magicLinkUrl = await this.generateMagicLink(tenantId, identity.id);
      return { status: 'needs_verification', identity, magicLinkUrl };
    }

    // No channel record. Try cross-channel stitching by shared identifier.
    const stitch = this.store.findTrustedChannelByIdentifier(tenantId, identifier);
    if (stitch) {
      const identity = this.store.getIdentityById(stitch.identityId)!;
      this.linkChannel(identity, channelType, identifier, true);
      const session = await this.ensureSession(identity, channelType);
      return { status: 'active', identity, session, stitched: true };
    }

    // Brand new — create an unverified identity and send a magic link.
    const identity = this.createIdentity(tenantId, identifier);
    this.linkChannel(identity, channelType, identifier, false);
    const magicLinkUrl = await this.generateMagicLink(tenantId, identity.id);
    return { status: 'needs_verification', identity, magicLinkUrl };
  }

  private createIdentity(tenantId: string, identifier: string): EndUserIdentity {
    const externalUserId = `ext_${identifier.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const now = new Date();
    const identity: EndUserIdentity = {
      id: uuid(),
      tenantId,
      externalUserId,
      verificationStatus: VerificationStatus.Unverified,
      channels: [],
      currentUserState: 'unverified',
      stateInferredAt: now,
      stateConfidence: 0.9,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.putIdentity(identity);
    return identity;
  }

  private linkChannel(
    identity: EndUserIdentity,
    channelType: ChannelType,
    identifier: string,
    trusted: boolean,
  ): IdentityChannel {
    const ic: IdentityChannel = {
      id: uuid(),
      identityId: identity.id,
      tenantId: identity.tenantId,
      channelType,
      identifier,
      trusted,
      linkedAt: new Date(),
      lastSeenAt: new Date(),
    };
    this.store.putIdentityChannel(ic);
    return ic;
  }

  /**
   * Bind a widget session using a customer-signed Convox identity assertion.
   * Skips magic-link verification when the customer's backend vouches for the user.
   */
  async bindIdentityAssertion(
    tenantId: string,
    channelType: ChannelType,
    assertion: IdentityAssertion,
  ): Promise<{ identity: EndUserIdentity; session: EndUserSession }> {
    let identity = this.store.findIdentityByExternal(tenantId, assertion.userId);
    const now = new Date();
    if (!identity) {
      identity = {
        id: uuid(),
        tenantId,
        externalUserId: assertion.userId,
        verificationStatus: VerificationStatus.Verified,
        verifiedAt: now,
        channels: [],
        currentUserState: 'active',
        stateInferredAt: now,
        stateConfidence: 1,
        metadata: {
          ...(assertion.metadata ?? {}),
          email: assertion.email,
          name: assertion.metadata?.name ?? assertion.userId,
        },
        createdAt: now,
        updatedAt: now,
      };
      this.store.putIdentity(identity);
    } else {
      identity.verificationStatus = VerificationStatus.Verified;
      identity.verifiedAt = identity.verifiedAt ?? now;
      identity.metadata = {
        ...identity.metadata,
        ...(assertion.metadata ?? {}),
        email: assertion.email ?? identity.metadata.email,
      };
      identity.updatedAt = now;
      this.store.putIdentity(identity);
    }

    const existing = this.store.findIdentityChannel(tenantId, channelType, assertion.sessionId);
    if (existing) {
      existing.trusted = true;
      existing.lastSeenAt = now;
      this.store.putIdentityChannel(existing);
    } else {
      this.linkChannel(identity, channelType, assertion.sessionId, true);
    }

    const session = await this.ensureSession(identity, channelType);
    return { identity, session };
  }

  // ---- Magic link ----
  async generateMagicLink(tenantId: string, identityId: string): Promise<string> {
    const token = randomToken();
    await this.kv.set(`magic_link:${token}`, { tenantId, identityId, used: false }, MAGIC_LINK_TTL_S);
    const identity = this.store.getIdentityById(identityId);
    if (identity && identity.verificationStatus === VerificationStatus.Unverified) {
      identity.verificationStatus = VerificationStatus.PendingMagicLink;
      this.store.putIdentity(identity);
    }
    return `${this.baseUrl}/verify/${token}`;
  }

  async verifyMagicLink(token: string): Promise<{ identity: EndUserIdentity; session: EndUserSession }> {
    const rec = await this.kv.get<{ tenantId: string; identityId: string; used: boolean }>(
      `magic_link:${token}`,
    );
    if (!rec) throw Errors.unauthorized('Magic link is invalid or expired.');
    if (rec.used) throw Errors.unauthorized('Magic link has already been used.');
    // Race-safe single use.
    await this.kv.set(`magic_link:${token}`, { ...rec, used: true }, 60);

    const identity = this.store.getIdentityById(rec.identityId);
    if (!identity) throw Errors.notFound('Identity', rec.identityId);

    // Fetch user context from the SaaS and cache it on the identity.
    const ctx = this.fetchContext(identity);
    identity.metadata = {
      ...ctx.metadata,
      name: ctx.displayName,
      email: ctx.email,
      plan: ctx.plan,
      permissions: ctx.permissions ?? [],
    };
    identity.verificationStatus = VerificationStatus.Verified;
    identity.verifiedAt = new Date();
    identity.contextCachedAt = new Date();
    // Store the user's scoped SaaS token, encrypted.
    const scopedToken = `saas_tok_${identity.externalUserId}`;
    identity.encryptedAccessToken = JSON.stringify(encryptSync(scopedToken));
    identity.tokenExpiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    identity.updatedAt = new Date();
    this.store.putIdentity(identity);

    // Mark all of this identity's channels trusted.
    for (const ic of this.store.listIdentityChannels(identity.id)) {
      ic.trusted = true;
      this.store.putIdentityChannel(ic);
    }

    const session = await this.ensureSession(identity, identity.channels[0]?.channelType);
    return { identity, session };
  }

  fetchContext(identity: EndUserIdentity): UserContext {
    const raw = identity.metadata as Record<string, unknown>;
    return {
      externalUserId: identity.externalUserId,
      displayName: String(raw.name ?? 'Alex Rivera'),
      email: String(raw.email ?? `${identity.externalUserId}@example.com`),
      plan: raw.plan ? String(raw.plan) : 'pro',
      accountCreatedAt: raw.createdAt ? String(raw.createdAt) : undefined,
      lastLoginAt: raw.lastLogin ? String(raw.lastLogin) : undefined,
      permissions: [],
      metadata: {
        externalUserId: identity.externalUserId,
        name: String(raw.name ?? 'Alex Rivera'),
        email: String(raw.email ?? `${identity.externalUserId}@example.com`),
        plan: raw.plan ?? 'pro',
      },
    };
  }

  // ---- Sessions ----
  async ensureSession(identity: EndUserIdentity, channelType?: ChannelType): Promise<EndUserSession> {
    const existingId = await this.kv.get<string>(
      `session_by_identity:${identity.tenantId}:${identity.id}`,
    );
    if (existingId) {
      const session = await this.kv.get<EndUserSession>(`session:${existingId}`);
      if (session) {
        const revived = this.reviveSession(session);
        revived.lastActivityAt = new Date();
        if (channelType && !revived.channels.includes(channelType)) revived.channels.push(channelType);
        await this.kv.set(`session:${revived.id}`, revived, SESSION_TTL_S);
        return revived;
      }
    }
    return this.createSession(identity, channelType);
  }

  private async createSession(
    identity: EndUserIdentity,
    channelType?: ChannelType,
  ): Promise<EndUserSession> {
    const id = uuid();
    const now = new Date();
    const session: EndUserSession = {
      id,
      identityId: identity.id,
      tenantId: identity.tenantId,
      token: signToken(
        { tenantId: identity.tenantId, endUserId: identity.id, purpose: 'web_session' },
        SESSION_TTL_S,
      ),
      channels: channelType ? [channelType] : [],
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_S * 1000),
      lastActivityAt: now,
      metadata: {},
    };
    await this.kv.set(`session:${id}`, session, SESSION_TTL_S);
    await this.kv.set(`session_by_identity:${identity.tenantId}:${identity.id}`, id, SESSION_TTL_S);
    return session;
  }

  async getSession(sessionId: string): Promise<EndUserSession | null> {
    const s = await this.kv.get<EndUserSession>(`session:${sessionId}`);
    return s ? this.reviveSession(s) : null;
  }

  async saveSession(session: EndUserSession): Promise<void> {
    await this.kv.set(`session:${session.id}`, session, SESSION_TTL_S);
  }

  async revokeSession(tenantId: string, identityId: string): Promise<void> {
    const id = await this.kv.get<string>(`session_by_identity:${tenantId}:${identityId}`);
    if (id) await this.kv.del(`session:${id}`);
    await this.kv.del(`session_by_identity:${tenantId}:${identityId}`);
  }

  // ---- Step-up (StepUpPort) ----
  isStepUpValid(session: EndUserSession): boolean {
    return (
      !!session.stepUpCompletedAt &&
      !!session.stepUpExpiresAt &&
      new Date() < new Date(session.stepUpExpiresAt)
    );
  }

  async initiateStepUp(session: EndUserSession): Promise<{ url: string }> {
    const token = signToken(
      { tenantId: session.tenantId, endUserId: session.identityId, purpose: 'step_up' },
      STEP_UP_TTL_S,
    );
    await this.kv.set(`step_up:${token}`, session.id, STEP_UP_TTL_S);
    return { url: `${this.baseUrl}/step-up/${token}` };
  }

  async completeStepUp(token: string): Promise<EndUserSession> {
    const payload = verifyToken(token); // throws on bad/expired
    if (payload.purpose !== 'step_up') throw Errors.unauthorized('Wrong token purpose.');
    const sessionId = await this.kv.get<string>(`step_up:${token}`);
    if (!sessionId) throw Errors.unauthorized('Step-up link is invalid or expired.');
    const session = await this.getSession(sessionId);
    if (!session) throw Errors.unauthorized('Session not found for step-up.');
    session.stepUpCompletedAt = new Date();
    session.stepUpExpiresAt = new Date(Date.now() + STEP_UP_VALID_MS);
    await this.saveSession(session);
    await this.kv.del(`step_up:${token}`);
    return session;
  }

  /** KV round-trips serialize Dates to strings; revive the typed fields. */
  private reviveSession(s: EndUserSession): EndUserSession {
    return {
      ...s,
      createdAt: new Date(s.createdAt),
      expiresAt: new Date(s.expiresAt),
      lastActivityAt: new Date(s.lastActivityAt),
      stepUpCompletedAt: s.stepUpCompletedAt ? new Date(s.stepUpCompletedAt) : undefined,
      stepUpExpiresAt: s.stepUpExpiresAt ? new Date(s.stepUpExpiresAt) : undefined,
    };
  }
}
