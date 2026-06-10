import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

/**
 * The ONLY place encryption / token-signing logic lives. Tenant secrets are
 * never stored in plaintext.
 *
 * Production uses AWS KMS envelope encryption (KMS encrypts a per-record data
 * key; the data key encrypts the secret). Here we use a master key from
 * MASTER_ENCRYPTION_KEY directly — the `keyVersion` field reserves the same
 * rotation story KMS would provide.
 */

const ALGO = 'aes-256-gcm';

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64 — randomized per call
  tag: string; // base64 — GCM auth tag
  keyVersion: string;
}

function masterKey(): Buffer {
  const hex = process.env.MASTER_ENCRYPTION_KEY ?? 'a'.repeat(64);
  // 64 hex chars => 32 bytes. Accept raw 32-byte utf8 too.
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  const buf = Buffer.from(hex, 'utf8');
  if (buf.length < 32) throw new Error('MASTER_ENCRYPTION_KEY too short');
  return buf.subarray(0, 32);
}

function secret(): Buffer {
  const s = process.env.INTERNAL_SERVICE_SECRET ?? 's'.repeat(48);
  return Buffer.from(s, 'utf8');
}

export function encryptSync(plaintext: string, keyVersion = 'v1'): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion,
  };
}

export function decryptSync(enc: EncryptedValue): string {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(enc.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

// Async wrappers matching the manual's signature (KMS calls are async in prod).
export async function encrypt(plaintext: string): Promise<EncryptedValue> {
  return encryptSync(plaintext);
}
export async function decrypt(enc: EncryptedValue): Promise<string> {
  return decryptSync(enc);
}

// ---------- Tokens (HMAC-signed, stateless) ----------

export interface TokenPayload {
  tenantId: string;
  endUserId: string;
  purpose: 'magic_link' | 'step_up' | 'web_session' | 'confirmation' | 'admin';
  issuedAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
  /** Optional opaque extra payload (e.g. action key + args hash for confirmations). */
  ext?: Record<string, unknown>;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signToken(
  payload: Omit<TokenPayload, 'issuedAt' | 'expiresAt'>,
  expiresInSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const full: TokenPayload = { ...payload, issuedAt: now, expiresAt: now + expiresInSeconds };
  const body = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  const sig = b64url(createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}

export class TokenError extends Error {}

export function verifyToken(token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new TokenError('malformed token');
  const [body, sig] = parts as [string, string];
  const expected = b64url(createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new TokenError('bad signature');
  const payload = JSON.parse(b64urlDecode(body).toString('utf8')) as TokenPayload;
  if (Math.floor(Date.now() / 1000) > payload.expiresAt) throw new TokenError('expired');
  return payload;
}

/** Random URL-safe token with 256 bits of entropy (magic links, etc.). */
export function randomToken(): string {
  return b64url(randomBytes(32));
}

/** Mask a secret for display: keep last 4 chars. */
export function maskSecret(value: string): string {
  if (value.length <= 4) return '••••';
  return '••••••••' + value.slice(-4);
}

// ---------- Password hashing (scrypt) ----------

/** Hash a password with a random salt → `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verify a password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
