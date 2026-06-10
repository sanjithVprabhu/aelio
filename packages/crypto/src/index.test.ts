import { describe, it, expect } from 'vitest';
import {
  encryptSync,
  decryptSync,
  signToken,
  verifyToken,
  TokenError,
  maskSecret,
  hashPassword,
  verifyPassword,
} from './index.js';

describe('crypto', () => {
  it('encrypt then decrypt roundtrips plaintext unchanged', () => {
    const pt = 'sk_live_super_secret_token_value';
    const enc = encryptSync(pt);
    expect(enc.ciphertext).not.toContain(pt);
    expect(decryptSync(enc)).toBe(pt);
  });

  it('two encryptions of same input produce different ciphertexts (random IV)', () => {
    const a = encryptSync('same');
    const b = encryptSync('same');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptSync(a)).toBe(decryptSync(b));
  });

  it('decrypt fails on a tampered ciphertext', () => {
    const enc = encryptSync('hello');
    const tampered = { ...enc, ciphertext: Buffer.from('different').toString('base64') };
    expect(() => decryptSync(tampered)).toThrow();
  });

  it('verifyToken rejects an expired token', () => {
    const tok = signToken({ tenantId: 't', endUserId: 'u', purpose: 'magic_link' }, -1);
    expect(() => verifyToken(tok)).toThrow(TokenError);
  });

  it('verifyToken rejects a tampered token', () => {
    const tok = signToken({ tenantId: 't', endUserId: 'u', purpose: 'step_up' }, 60);
    const tampered = tok.slice(0, -2) + (tok.endsWith('a') ? 'bb' : 'aa');
    expect(() => verifyToken(tampered)).toThrow(TokenError);
  });

  it('verifyToken accepts a valid token and returns the payload', () => {
    const tok = signToken({ tenantId: 't1', endUserId: 'u1', purpose: 'magic_link' }, 900);
    const p = verifyToken(tok);
    expect(p.tenantId).toBe('t1');
    expect(p.endUserId).toBe('u1');
    expect(p.purpose).toBe('magic_link');
    expect(p.expiresAt).toBeGreaterThan(p.issuedAt);
  });

  it('maskSecret keeps only the last 4 chars', () => {
    expect(maskSecret('EAAGabcd1234WXYZ')).toBe('••••••••WXYZ');
  });

  it('hashPassword + verifyPassword roundtrips and rejects wrong passwords', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('hashPassword produces a different hash each call (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});
