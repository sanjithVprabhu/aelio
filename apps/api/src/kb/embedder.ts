import { createHash } from 'node:crypto';

/**
 * Deterministic, dependency-free embedder. Hashes tokens into a fixed‑dimension
 * bag‑of‑words vector and L2‑normalizes — good enough for semantic‑ish retrieval
 * in the demo with zero external services. The production swap is a real
 * embedding model behind the same `embed()` signature; pgvector stores the
 * vectors (see packages/db `kb_chunks`).
 */
export const EMBED_DIM = 256;

export interface Embedder {
  embed(text: string): number[];
  readonly model: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function bucket(token: string): number {
  const h = createHash('md5').update(token).digest();
  return ((h[0]! << 8) | h[1]!) % EMBED_DIM;
}

export class HashingEmbedder implements Embedder {
  readonly model = 'aelio-hashing-256';

  embed(text: string): number[] {
    const v = new Array<number>(EMBED_DIM).fill(0);
    for (const tok of tokenize(text)) {
      v[bucket(tok)]! += 1;
    }
    // L2 normalize so dot product == cosine similarity.
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}
