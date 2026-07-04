import type { Embedder } from '@aelio/embedder';
import type { DbConnection } from '@aelio/db';
import { vectorLiteral } from '@aelio/embedder';
import { createLogger } from '@aelio/logger';
import type {
  IndexEpisodeInput,
  IndexTurnInput,
  MemoryEngine,
  MemoryHit,
  SearchMemoryInput,
} from './types.js';

const log = createLogger({ engine: 'postgres-memory' });

function pgVector(vec: number[]): string {
  return `'${vectorLiteral(vec)}'::vector`;
}

/** pgvector-backed turn index (existing v1 path). */
export class PostgresMemoryAdapter implements MemoryEngine {
  readonly name = 'postgres' as const;

  constructor(
    private readonly sql: DbConnection['sql'],
    private readonly embedder: Embedder,
  ) {}

  async ensureReady(): Promise<void> {
    // turn_embeddings table created by migration.
  }

  indexTurn(input: IndexTurnInput): void {
    void this.indexTurnAsync(input).catch((err) => log.warn({ err }, 'turn index failed'));
  }

  indexEpisode(_input: IndexEpisodeInput): void {
    // Episodes stored in memory_episodes table by the API layer when using postgres-only mode.
  }

  private async indexTurnAsync(input: IndexTurnInput): Promise<void> {
    const text = input.text.trim();
    if (!text) return;
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
  }

  async search(input: SearchMemoryInput): Promise<MemoryHit[]> {
    const text = input.queryText.trim();
    if (!text) return [];
    const limit = input.limit ?? 8;
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(text);
    } catch (err) {
      log.warn({ err }, 'search embed failed');
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

    return rows.map((r) => ({
      episodeId: r.turn_id,
      turnId: r.turn_id,
      conversationId: r.conversation_id,
      role: r.role,
      text: r.content_text,
      score: Number(r.score),
      createdAt: new Date(r.created_at),
    }));
  }
}