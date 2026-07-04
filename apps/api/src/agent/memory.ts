import type { MemoryEngine } from '@aelio/memory-engine';
import type { Kv } from '../store/kv.js';
import type { Store, LongTermFact } from '../store/store.js';
import type { Turn } from '@aelio/types';
import { ChannelType } from '@aelio/types';
import { uuid } from '../util/id.js';

const WORKING_TTL_S = 24 * 60 * 60;
const RECENT_TURNS = 6;
const VECTOR_TURNS = 8;

export interface WorkingMemory {
  entities: Record<string, unknown>;
  slots: Record<string, unknown>;
}

export interface ConversationHistoryResult {
  turns: Turn[];
  memoryHits: number;
}

/**
 * Memory: working KV slots, long-term facts, and MemoryEngine retrieval (Postgres or SunJet).
 */
export class MemoryService {
  private engine?: MemoryEngine;

  constructor(
    private readonly kv: Kv,
    private readonly store: Store,
    engine?: MemoryEngine,
  ) {
    this.engine = engine;
  }

  setMemoryEngine(engine: MemoryEngine): void {
    this.engine = engine;
  }

  async rollupLayers(): Promise<{ l1: number; l2: number; l3: number }> {
    if (!this.engine?.rollupLayers) return { l1: 0, l2: 0, l3: 0 };
    return this.engine.rollupLayers();
  }

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
    if (confidence < 0.75) return;
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

  indexTurn(input: { turn: Turn; identityId: string; text: string }): void {
    this.engine?.indexTurn({
      turnId: input.turn.id,
      tenantId: input.turn.tenantId,
      identityId: input.identityId,
      conversationId: input.turn.conversationId,
      role: input.turn.role,
      text: input.text,
    });
  }

  indexIntentEpisode(input: {
    tenantId: string;
    identityId: string;
    conversationId: string;
    intentKey: string;
    phase: string;
    body: string;
    startedAt: Date;
    endedAt: Date;
  }): void {
    this.engine?.indexEpisode({
      episodeId: uuid(),
      ...input,
    });
  }

  async buildConversationHistory(input: {
    tenantId: string;
    identityId: string;
    conversationId: string;
    queryText: string;
  }): Promise<ConversationHistoryResult> {
    const all = this.store.listTurns(input.tenantId, input.conversationId);
    const recentTurns = all.slice(-RECENT_TURNS, -1);
    const excludeIds = all.length ? [all[all.length - 1]!.id] : [];

    if (!this.engine) {
      return { turns: recentTurns, memoryHits: 0 };
    }

    const hits = await this.engine.search({
      tenantId: input.tenantId,
      identityId: input.identityId,
      queryText: input.queryText,
      limit: VECTOR_TURNS,
      excludeTurnIds: excludeIds,
    });

    const channelType = recentTurns[0]?.channelType ?? ChannelType.WebChat;
    const byId = new Map<string, Turn>();
    for (const hit of hits) {
      const id = hit.turnId ?? hit.episodeId;
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        conversationId: hit.conversationId,
        tenantId: input.tenantId,
        role: hit.role === 'assistant' ? 'assistant' : 'user',
        content: { type: 'text', text: hit.text },
        channelType,
        createdAt: hit.createdAt,
      });
    }
    for (const turn of recentTurns) byId.set(turn.id, turn);

    const turns = [...byId.values()]
      .sort((a, b) => turnTime(a) - turnTime(b))
      .slice(-12);

    return { turns, memoryHits: hits.length };
  }
}

function turnTime(turn: Turn): number {
  const t = turn.createdAt;
  return t instanceof Date ? t.getTime() : new Date(t as string).getTime();
}