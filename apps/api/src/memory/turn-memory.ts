import type { DbConnection } from '@aelio/db';
import type { Embedder } from '@aelio/embedder';
import { vectorLiteral } from '@aelio/embedder';
import { ChannelType, type Turn } from '@aelio/types';
import { createLogger } from '@aelio/logger';

const log = createLogger({});

export interface TurnMemoryHit {
  turnId: string;
  conversationId: string;
  role: string;
  contentText: string;
  createdAt: Date;
  score: number;
}

function pgVector(vec: number[]): string {
  return `'${vectorLiteral(vec)}'::vector`;
}

/** pgvector-backed semantic index over conversation turns. */
export class TurnMemoryIndex {
  constructor(
    private readonly sql: DbConnection['sql'],
    private readonly embedder: Embedder,
  ) {}

  /** Index a turn for later retrieval (idempotent on turn_id). */
  async indexTurn(input: {
    turnId: string;
    tenantId: string;
    identityId: string;
    conversationId: string;
    role: string;
    text: string;
  }): Promise<void> {
    const text = input.text.trim();
    if (!text) return;
    try {
      const embedding = await this.embedder.embed(text);
      const vec = pgVector(embedding);
      await this.sql.unsafe(`
        INSERT INTO turn_embeddings (
          turn_id, tenant_id, identity_id, conversation_id, role, content_text, embedding
        ) VALUES (
          '${input.turnId}',
          '${input.tenantId}',
          '${input.identityId}',
          '${input.conversationId}',
          '${input.role.replace(/'/g, "''")}',
          '${text.replace(/'/g, "''")}',
          ${vec}
        )
        ON CONFLICT (turn_id) DO NOTHING
      `);
    } catch (err) {
      log.warn({ err, turnId: input.turnId }, 'turn embedding index failed');
    }
  }

  /** Fire-and-forget wrapper used on the hot path. */
  scheduleIndex(input: Parameters<TurnMemoryIndex['indexTurn']>[0]): void {
    void this.indexTurn(input).catch((err) => log.warn({ err }, 'scheduled turn index failed'));
  }

  async searchSimilar(input: {
    tenantId: string;
    identityId: string;
    queryText: string;
    limit?: number;
    excludeTurnIds?: string[];
  }): Promise<TurnMemoryHit[]> {
    const text = input.queryText.trim();
    if (!text) return [];
    const limit = input.limit ?? 8;
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(text);
    } catch (err) {
      log.warn({ err }, 'turn memory search embed failed — skipping vector retrieval');
      return [];
    }
    const vec = pgVector(embedding);
    const exclude = input.excludeTurnIds ?? [];

    const excludeClause =
      exclude.length > 0
        ? `AND NOT (turn_id = ANY(ARRAY[${exclude.map((id) => `'${id}'`).join(',')}]::uuid[]))`
        : '';

    type Row = {
      turn_id: string;
      conversation_id: string;
      role: string;
      content_text: string;
      created_at: Date;
      score: number;
    };

    const rows = await this.sql.unsafe<Row[]>(`
      SELECT turn_id, conversation_id, role, content_text, created_at,
             1 - (embedding <=> ${vec}) AS score
      FROM turn_embeddings
      WHERE tenant_id = '${input.tenantId}'
        AND identity_id = '${input.identityId}'
        ${excludeClause}
      ORDER BY embedding <=> ${vec}
      LIMIT ${limit}
    `);

    return rows.map((r: Row) => ({
      turnId: r.turn_id,
      conversationId: r.conversation_id,
      role: r.role,
      contentText: r.content_text,
      createdAt: new Date(r.created_at),
      score: Number(r.score),
    }));
  }
}

function turnTime(turn: Turn): number {
  const t = turn.createdAt;
  return t instanceof Date ? t.getTime() : new Date(t as string).getTime();
}

/** Merge recent same-conversation turns with cross-session vector hits. */
export function mergeHistoryTurns(input: {
  tenantId: string;
  recentTurns: Turn[];
  memoryHits: TurnMemoryHit[];
  maxTurns?: number;
}): Turn[] {
  const max = input.maxTurns ?? 12;
  const byId = new Map<string, Turn>();
  const channelType = input.recentTurns[0]?.channelType ?? ChannelType.WebChat;

  for (const hit of input.memoryHits) {
    if (byId.has(hit.turnId)) continue;
    byId.set(hit.turnId, {
      id: hit.turnId,
      conversationId: hit.conversationId,
      tenantId: input.tenantId,
      role: hit.role === 'assistant' ? 'assistant' : 'user',
      content: { type: 'text', text: hit.contentText },
      channelType,
      createdAt: hit.createdAt,
    });
  }

  for (const turn of input.recentTurns) {
    byId.set(turn.id, turn);
  }

  return [...byId.values()]
    .sort((a, b) => turnTime(a) - turnTime(b))
    .slice(-max);
}