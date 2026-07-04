import { SunJetClient, SunJetStateClient } from '@aelio/sunjet-client';
import type { Kv } from '../store/kv.js';

/** SunJet-backed KV — replaces Redis/InMemory for production hot state. */
export class SunJetKv implements Kv {
  private readonly state: SunJetStateClient;

  constructor(client: SunJetClient) {
    this.state = new SunJetStateClient(client);
  }

  async ensureReady(): Promise<void> {
    await this.state.ensureSchema();
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return (await this.state.get(key)) as T | null;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.state.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.state.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.state.incr(key, 3600);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const v = await this.get(key);
    if (v !== null) await this.set(key, v, ttlSeconds);
  }

  async setNx(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }
}