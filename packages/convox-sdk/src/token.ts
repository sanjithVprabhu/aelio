import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ExecuteContext, IdentityAssertion } from './types.js';

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

interface SignedPayload {
  purpose: 'identify' | 'execute';
  tenantId: string;
  issuedAt: number;
  expiresAt: number;
  [key: string]: unknown;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signPayload(payload: SignedPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

function verifySignedToken<T extends SignedPayload>(token: string, secret: string): T {
  const parts = token.split('.');
  if (parts.length !== 2) throw new TokenError('Malformed token.');
  const [body, sig] = parts as [string, string];
  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new TokenError('Invalid token signature.');
  }
  const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as T;
  if (Math.floor(Date.now() / 1000) > payload.expiresAt) {
    throw new TokenError('Token expired.');
  }
  return payload;
}

/** Create a signed identity assertion for Aelio to bind a widget session to a user. */
export function signIdentity(
  tenantId: string,
  apiKey: string,
  assertion: IdentityAssertion,
  expiresInSeconds = 300,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(
    {
      purpose: 'identify',
      tenantId,
      sessionId: assertion.sessionId,
      userId: assertion.userId,
      email: assertion.email,
      metadata: assertion.metadata,
      issuedAt: now,
      expiresAt: now + expiresInSeconds,
    },
    apiKey,
  );
}

/** Verify a customer-signed identity assertion from the Convox SDK. */
export function verifyIdentityToken(
  token: string,
  apiKey: string,
): IdentityAssertion & { tenantId: string } {
  const payload = verifySignedToken<
    SignedPayload & {
      sessionId: string;
      userId: string;
      email?: string;
      metadata?: Record<string, unknown>;
    }
  >(token, apiKey);

  if (payload.purpose !== 'identify') throw new TokenError('Wrong token purpose.');

  return {
    tenantId: payload.tenantId,
    sessionId: payload.sessionId,
    userId: payload.userId,
    email: payload.email,
    metadata: payload.metadata,
  };
}

/** Verify the per-execute JWT from Aelio and return trusted context fields. */
export function verifyExecuteToken(
  token: string,
  apiKey: string,
  expected: { invocationId: string; tenantId: string; tool: string },
): ExecuteContext {
  const payload = verifySignedToken<
    SignedPayload & {
      invocationId: string;
      tool: string;
      externalUserId: string;
      email?: string;
      verified: boolean;
      stepUpValid: boolean;
      sessionId?: string;
      metadata?: Record<string, unknown>;
    }
  >(token, apiKey);

  if (payload.purpose !== 'execute') throw new TokenError('Wrong token purpose.');
  if (payload.tenantId !== expected.tenantId) throw new TokenError('Tenant mismatch.');
  if (payload.invocationId !== expected.invocationId) throw new TokenError('Invocation mismatch.');
  if (payload.tool !== expected.tool) throw new TokenError('Tool mismatch.');

  return {
    invocationId: payload.invocationId,
    tenantId: payload.tenantId,
    externalUserId: payload.externalUserId,
    email: payload.email,
    verified: payload.verified === true,
    stepUpValid: payload.stepUpValid === true,
    sessionId: payload.sessionId,
    metadata: payload.metadata,
  };
}

/** Generate a stable instance id when the customer does not provide one. */
export function defaultInstanceId(): string {
  return `convox_${randomUUID()}`;
}

/** Sign an execute token (used by the mock server in tests; Aelio server will do the same). */
export function signExecuteToken(
  apiKey: string,
  input: {
    tenantId: string;
    invocationId: string;
    tool: string;
    context: ExecuteContext;
  },
  expiresInSeconds = 60,
): string {
  const now = Math.floor(Date.now() / 1000);
  const { context } = input;
  return signPayload(
    {
      purpose: 'execute',
      tenantId: input.tenantId,
      invocationId: input.invocationId,
      tool: input.tool,
      externalUserId: context.externalUserId,
      email: context.email,
      verified: context.verified,
      stepUpValid: context.stepUpValid,
      sessionId: context.sessionId,
      metadata: context.metadata,
      issuedAt: now,
      expiresAt: now + expiresInSeconds,
    },
    apiKey,
  );
}