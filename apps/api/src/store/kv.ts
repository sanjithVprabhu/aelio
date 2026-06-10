/**
 * Redis-like key/value store with TTL and atomic counters. Backs sessions,
 * magic-link/step-up/OTP tokens, pending confirmations, rate limits, and
 * working memory. In-memory by default (zero infra); a Redis-backed
 * implementation of the same interface is the production swap.
 */
export interface Kv {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic increment; returns the new value. */
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  /** Set only if absent; returns true if it was set (used for dedup/locks). */
  setNx(key: string, value: unknown, ttlSeconds?: number): Promise<boolean>;
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

export class InMemoryKv implements Kv {
  private map = new Map<string, Entry>();

  private live(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && Date.now() > e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const e = this.live(key);
    return e ? (structuredClone(e.value) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    this.map.set(key, {
      value: structuredClone(value),
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async incr(key: string): Promise<number> {
    const e = this.live(key);
    const next = ((e?.value as number) ?? 0) + 1;
    this.map.set(key, { value: next, expiresAt: e?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const e = this.live(key);
    if (e) e.expiresAt = Date.now() + ttlSeconds * 1000;
  }

  async setNx(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    if (this.live(key)) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }
}
