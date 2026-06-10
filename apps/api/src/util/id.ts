import { randomUUID, randomBytes } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
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
