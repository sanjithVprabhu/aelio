import { createHash, randomUUID, randomBytes } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

/**
 * Deterministic UUID derived from an arbitrary string.
 * Useful when external catalog keys need a stable Postgres-safe primary key.
 */
export function stableUuid(input: string): string {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 32);
  const chars = hex.split('');
  chars[12] = '4';
  const variant = parseInt(chars[16]!, 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  return [
    chars.slice(0, 8).join(''),
    chars.slice(8, 12).join(''),
    chars.slice(12, 16).join(''),
    chars.slice(16, 20).join(''),
    chars.slice(20, 32).join(''),
  ].join('-');
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let seq = 0;

/** Monotonic ULID-ish id: time-sortable, used for audit event ids. */
export function ulid(): string {
  let t = Date.now();
  if (t === lastTime) seq += 1;
  else {
    seq = 0;
    lastTime = t;
  }
  let timePart = '';
  let tv = t;
  for (let i = 0; i < 10; i++) {
    timePart = B32[tv % 32] + timePart;
    tv = Math.floor(tv / 32);
  }
  const rnd = randomBytes(8).toString('hex').toUpperCase();
  return timePart + rnd + seq.toString().padStart(2, '0');
}
