import type { KbChunk, KbCollection, KbSource, RetrievedChunk } from '@aelio/types';
import type { Store } from '../store/store.js';
import { uuid } from '../util/id.js';
import { cosine, HashingEmbedder, type Embedder } from './embedder.js';

const MIN_RELEVANCE = 0.01; // RRF fused scores are small (~1/(k+rank))
const MAX_CONTEXT_CHUNKS = 4;
const RRF_K = 60;

/** Layer 4 — KB management + hybrid retrieval (semantic + keyword) with RRF fusion. */
export class RagService {
  private embedder: Embedder = new HashingEmbedder();

  constructor(private readonly store: Store) {}

  createCollection(
    tenantId: string,
    name: string,
    description = '',
    chunkSize = 600,
    overlap = 80,
  ): KbCollection {
    const now = new Date();
    const col: KbCollection = {
      id: uuid(),
      tenantId,
      name,
      description,
      chunkSize,
      overlap,
      embeddingModel: this.embedder.model,
      createdAt: now,
      updatedAt: now,
    };
    this.store.putCollection(col);
    return col;
  }

  /** Add a text/url/file source and index it immediately (offline = synchronous). */
  addSource(
    tenantId: string,
    collectionId: string,
    input: { type: 'file' | 'url' | 'text'; name: string; url?: string; content: string },
  ): KbSource {
    const col = this.store.getCollection(tenantId, collectionId);
    if (!col) throw new Error('collection not found');
    const source: KbSource = {
      id: uuid(),
      collectionId,
      tenantId,
      type: input.type,
      name: input.name,
      url: input.url,
      status: 'indexing',
      chunkCount: 0,
      createdAt: new Date(),
    };
    this.store.putSource(source);
    this.indexSource(col, source, input.content);
    return source;
  }

  reindex(tenantId: string, collectionId: string, sourceId: string, content: string): void {
    const col = this.store.getCollection(tenantId, collectionId);
    const source = this.store.listSources(tenantId, collectionId).find((s) => s.id === sourceId);
    if (!col || !source) return;
    this.store.clearChunksForSource(sourceId);
    this.indexSource(col, source, content);
  }

  private indexSource(col: KbCollection, source: KbSource, content: string): void {
    const chunks = chunkText(content, col.chunkSize, col.overlap);
    for (const text of chunks) {
      const chunk: KbChunk = {
        id: uuid(),
        tenantId: col.tenantId,
        collectionId: col.id,
        sourceId: source.id,
        sourceTitle: source.name,
        content: text,
        embedding: this.embedder.embed(text),
        tokenCount: Math.ceil(text.length / 4),
        createdAt: new Date(),
      };
      this.store.putChunk(chunk);
    }
    source.chunkCount = chunks.length;
    source.status = 'indexed';
    source.indexedAt = new Date();
    this.store.putSource(source);
  }

  /** Hybrid retrieval: semantic (cosine) + keyword (token overlap), fused via RRF. */
  retrieve(tenantId: string, query: string, collectionIds: string[]): RetrievedChunk[] {
    if (collectionIds.length === 0) return [];
    const chunks = this.store.listChunks(tenantId, collectionIds);
    if (chunks.length === 0) return [];

    const qVec = this.embedder.embed(query);
    const qTokens = new Set(
      query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1),
    );

    const semantic = [...chunks]
      .map((c) => ({ c, score: cosine(qVec, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const keyword = [...chunks]
      .map((c) => {
        const toks = c.content.toLowerCase().split(/\s+/);
        const hits = toks.filter((t) => qTokens.has(t.replace(/[^a-z0-9]/g, ''))).length;
        return { c, score: hits };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Reciprocal rank fusion.
    const fused = new Map<string, { chunk: KbChunk; score: number }>();
    const addRanks = (list: Array<{ c: KbChunk }>) => {
      list.forEach((item, rank) => {
        const existing = fused.get(item.c.id);
        const inc = 1 / (RRF_K + rank + 1);
        if (existing) existing.score += inc;
        else fused.set(item.c.id, { chunk: item.c, score: inc });
      });
    };
    addRanks(semantic);
    addRanks(keyword);

    return [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .filter((x) => x.score >= MIN_RELEVANCE)
      .slice(0, MAX_CONTEXT_CHUNKS)
      .map((x) => ({
        chunkId: x.chunk.id,
        sourceTitle: x.chunk.sourceTitle,
        content: x.chunk.content,
        score: x.score,
      }));
  }
}

export function chunkText(text: string, size: number, overlap: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end).trim());
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
