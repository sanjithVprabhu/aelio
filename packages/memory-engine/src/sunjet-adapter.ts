import type { Embedder } from '@aelio/embedder';
import { SunJetClient } from '@aelio/sunjet-client';
import { createLogger } from '@aelio/logger';
import type {
  IndexEpisodeInput,
  IndexTurnInput,
  MemoryEngine,
  MemoryHit,
  RollupResult,
  SearchMemoryInput,
} from './types.js';
import type { SunJetApiValue } from '@aelio/sunjet-client';

const log = createLogger({ engine: 'sunjet-memory' });
const MEMORY_LAYERS = ['memory_l3', 'memory_l2', 'memory_l1', 'memory_l0'] as const;

export interface EpisodeBodyStore {
  putEpisode(input: IndexEpisodeInput & { sunjetRowId?: number }): void;
  getEpisodesByRowIds(
    tenantId: string,
    identityId: string,
    rowIds: number[],
  ): Promise<Array<{ rowId: number; episodeId: string; body: string; conversationId: string; intentKey: string; phase: string; createdAt: Date }>>;
  putTurnMapping(input: IndexTurnInput & { sunjetRowId: number }): void;
  getTurnsByRowIds(
    tenantId: string,
    identityId: string,
    rowIds: number[],
  ): Promise<Array<{ rowId: number; turnId: string; body: string; conversationId: string; role: string; createdAt: Date }>>;
}

/** SunJet hybrid index with episode bodies in Postgres pointers. */
export class SunJetMemoryAdapter implements MemoryEngine {
  readonly name = 'sunjet' as const;
  private ready = false;

  constructor(
    private readonly client: SunJetClient,
    private readonly embedder: Embedder,
    private readonly bodies: EpisodeBodyStore,
  ) {}

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    const dim = this.embedder.dimensions;
    await this.client.ensureMemoryL0Schema(dim);
    await this.client.ensureMemoryLayersSchema(dim);
    this.ready = true;
  }

  indexTurn(input: IndexTurnInput): void {
    void this.indexTurnAsync(input).catch((err) => log.warn({ err }, 'sunjet turn index failed'));
  }

  indexEpisode(input: IndexEpisodeInput): void {
    void this.indexEpisodeAsync(input).catch((err) => log.warn({ err }, 'sunjet episode index failed'));
  }

  private async indexTurnAsync(input: IndexTurnInput): Promise<void> {
    await this.ensureReady();
    const text = input.text.trim();
    if (!text) return;
    const embedding = await this.embedder.embed(text);
    const { row_id } = await this.client.insertRow('memory_l0', {
      tenant_id: { type: 'utf8', value: input.tenantId },
      identity_id: { type: 'utf8', value: input.identityId },
      conversation_id: { type: 'utf8', value: input.conversationId },
      intent_key: { type: 'utf8', value: '_turn' },
      phase: { type: 'utf8', value: input.role },
      body: { type: 'utf8', value: text },
      embedding: { type: 'vector', value: embedding },
      started_at: { type: 'i64', value: Date.now() },
      ended_at: { type: 'i64', value: Date.now() },
    });
    this.bodies.putTurnMapping({ ...input, sunjetRowId: row_id });
  }

  private async indexEpisodeAsync(input: IndexEpisodeInput): Promise<void> {
    await this.ensureReady();
    const body = input.body.trim();
    if (!body) return;
    const embedding = await this.embedder.embed(body);
    const { row_id } = await this.client.insertRow('memory_l0', {
      tenant_id: { type: 'utf8', value: input.tenantId },
      identity_id: { type: 'utf8', value: input.identityId },
      conversation_id: { type: 'utf8', value: input.conversationId },
      intent_key: { type: 'utf8', value: input.intentKey },
      phase: { type: 'utf8', value: input.phase },
      body: { type: 'utf8', value: body },
      embedding: { type: 'vector', value: embedding },
      started_at: { type: 'i64', value: input.startedAt.getTime() },
      ended_at: { type: 'i64', value: input.endedAt.getTime() },
    });
    this.bodies.putEpisode({ ...input, sunjetRowId: row_id });
  }

  async search(input: SearchMemoryInput): Promise<MemoryHit[]> {
    await this.ensureReady();
    const text = input.queryText.trim();
    if (!text) return [];
    const limit = input.limit ?? 8;
    let embedding: number[];
    try {
      embedding = await this.embedder.embed(text);
    } catch (err) {
      log.warn({ err }, 'sunjet search embed failed');
      return [];
    }

    const k = limit + (input.excludeTurnIds?.length ?? 0);
    const filters = [
      { col: 'tenant_id', op: 'eq' as const, value: { type: 'utf8' as const, value: input.tenantId } },
      { col: 'identity_id', op: 'eq' as const, value: { type: 'utf8' as const, value: input.identityId } },
    ];

    const merged = new Map<number, { score: number }>();
    for (const table of MEMORY_LAYERS) {
      try {
        const { results } = await this.client.query(table, {
          k,
          vector: { col: 'embedding', query: embedding },
          filters,
        });
        for (const hit of results) {
          const prev = merged.get(hit.row_id);
          if (!prev || hit.score > prev.score) merged.set(hit.row_id, { score: hit.score });
        }
      } catch (err) {
        log.warn({ err, table }, 'sunjet layer query failed');
      }
    }

    const results = [...merged.entries()]
      .map(([row_id, meta]) => ({ row_id, score: meta.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    const rowIds = results.map((r) => r.row_id);
    const [episodes, turns] = await Promise.all([
      this.bodies.getEpisodesByRowIds(input.tenantId, input.identityId, rowIds),
      this.bodies.getTurnsByRowIds(input.tenantId, input.identityId, rowIds),
    ]);

    const byRow = new Map<number, MemoryHit>();
    for (const ep of episodes) {
      byRow.set(ep.rowId, {
        episodeId: ep.episodeId,
        conversationId: ep.conversationId,
        role: 'assistant',
        text: ep.body,
        score: results.find((r) => r.row_id === ep.rowId)?.score ?? 0,
        createdAt: ep.createdAt,
        intentKey: ep.intentKey,
        phase: ep.phase,
      });
    }
    for (const t of turns) {
      if (input.excludeTurnIds?.includes(t.turnId)) continue;
      byRow.set(t.rowId, {
        episodeId: t.turnId,
        turnId: t.turnId,
        conversationId: t.conversationId,
        role: t.role,
        text: t.body,
        score: results.find((r) => r.row_id === t.rowId)?.score ?? 0,
        createdAt: t.createdAt,
      });
    }

    return [...byRow.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async rollupLayers(): Promise<RollupResult> {
    await this.ensureReady();
    const l1 = await this.rollupTable('memory_l0', 'memory_l1', 3);
    const l2 = await this.rollupTable('memory_l1', 'memory_l2', 2);
    const l3 = await this.rollupTable('memory_l2', 'memory_l3', 2);
    return { l1, l2, l3 };
  }

  private utf8(v: SunJetApiValue | undefined): string {
    if (!v || v.type !== 'utf8') return '';
    return v.value;
  }

  private async rollupTable(source: string, target: string, minGroup: number): Promise<number> {
    const { rows } = await this.client.scan(source, { k: 500 });
    if (rows.length < minGroup) return 0;

    const existingEdges = new Set<string>();
    try {
      const prior = await this.client.scan(target, { k: 500 });
      for (const row of prior.rows) {
        const edges = this.utf8(row.values.parent_edges);
        if (edges) existingEdges.add(edges);
      }
    } catch {
      // target table may be empty
    }

    const groups = new Map<string, Array<{ rowId: number; body: string; tenantId: string; identityId: string }>>();
    for (const row of rows) {
      const tenantId = this.utf8(row.values.tenant_id);
      const identityId = this.utf8(row.values.identity_id);
      const body = this.utf8(row.values.body);
      if (!tenantId || !identityId || !body) continue;
      const conversationId = this.utf8(row.values.conversation_id);
      const key = `${tenantId}:${identityId}:${conversationId || '_'}`;
      const bucket = groups.get(key) ?? [];
      bucket.push({ rowId: row.rowId, body, tenantId, identityId });
      groups.set(key, bucket);
    }

    let created = 0;
    for (const bucket of groups.values()) {
      if (bucket.length < minGroup) continue;
      const edges = bucket
        .map((b) => b.rowId)
        .sort((a, b) => a - b)
        .join(',');
      if (existingEdges.has(edges)) continue;
      const summary = bucket
        .map((b) => b.body)
        .join(' ')
        .slice(0, 800);
      const embedding = await this.embedder.embed(summary);
      await this.client.insertRow(target, {
        tenant_id: { type: 'utf8', value: bucket[0]!.tenantId },
        identity_id: { type: 'utf8', value: bucket[0]!.identityId },
        body: { type: 'utf8', value: summary },
        embedding: { type: 'vector', value: embedding },
        parent_edges: { type: 'utf8', value: edges },
      });
      existingEdges.add(edges);
      created += 1;
    }
    return created;
  }
}