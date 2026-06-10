import Redis from 'ioredis';
import type { Kv } from './kv.js';

/**
 * Redis-backed implementation of the Kv interface (the production swap for
 * InMemoryKv). Values are JSON-serialized; TTLs and atomic INCR map directly to
 * Redis. Used for sessions, magic-link/step-up/OTP tokens, pending
 * confirmations, working memory, rate limits, and message dedup.
 */
export class RedisKv implements Kv {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (ttlSeconds) await this.redis.set(key, raw, 'EX', ttlSeconds);
    else await this.redis.set(key, raw);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, ttlSeconds);
  }

  async setNx(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const raw = JSON.stringify(value);
    const res = ttlSeconds
      ? await this.redis.set(key, raw, 'EX', ttlSeconds, 'NX')
      : await this.redis.set(key, raw, 'NX');
    return res === 'OK';
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
