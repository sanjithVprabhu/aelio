import type { Kv } from '../store/kv.js';
import type { Store, LongTermFact } from '../store/store.js';
import { uuid } from '../util/id.js';

const WORKING_TTL_S = 24 * 60 * 60;

export interface WorkingMemory {
  entities: Record<string, unknown>;
  slots: Record<string, unknown>;
}

/**
 * Three-tier memory (manual §6 Memory System):
 *  - short-term: the last N turns (loaded from the store per turn)
 *  - working: named entities + slot values in the KV, TTL 24h per session
 *  - long-term: per-user facts in the store (opt-in, confidence ≥ 0.75)
 */
export class MemoryService {
  constructor(
    private readonly kv: Kv,
    private readonly store: Store,
  ) {}

  async getWorking(sessionId: string): Promise<WorkingMemory> {
    return (
      (await this.kv.get<WorkingMemory>(`working_memory:${sessionId}`)) ?? {
        entities: {},
        slots: {},
      }
    );
  }

  async setSlot(sessionId: string, key: string, value: unknown): Promise<void> {
    const wm = await this.getWorking(sessionId);
    wm.slots[key] = value;
    await this.kv.set(`working_memory:${sessionId}`, wm, WORKING_TTL_S);
  }

  async setEntity(sessionId: string, key: string, value: unknown): Promise<void> {
    const wm = await this.getWorking(sessionId);
    wm.entities[key] = value;
    await this.kv.set(`working_memory:${sessionId}`, wm, WORKING_TTL_S);
  }

  rememberFact(
    tenantId: string,
    identityId: string,
    key: string,
    value: unknown,
    confidence: number,
  ): void {
    if (confidence < 0.75) return; // opt-in threshold
    const fact: LongTermFact = {
      id: uuid(),
      identityId,
      tenantId,
      key,
      value,
      confidence,
      extractedAt: new Date(),
    };
    this.store.putFact(fact);
  }

  facts(tenantId: string, identityId: string): LongTermFact[] {
    return this.store.listFacts(tenantId, identityId);
  }
}
