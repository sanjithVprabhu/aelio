import { createHash } from 'node:crypto';
import { Errors } from '@aelio/errors';

/**
 * Embedding providers. The default `HashingEmbedder` is deterministic and
 * synchronous (zero infra). `OpenAIEmbedder` produces real semantic embeddings
 * and is selected when EMBEDDINGS_PROVIDER=openai + OPENAI_API_KEY are set. Both
 * implement the async `embed`; the hashing one also exposes a sync `embedSync`
 * used for the demo seed so container construction stays synchronous.
 */
export const EMBED_DIM = 256;

export interface Embedder {
  readonly model: string;
  embed(text: string): Promise<number[]>;
}

export interface SyncEmbedder extends Embedder {
  embedSync(text: string): number[];
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

export class HashingEmbedder implements SyncEmbedder {
  readonly model = 'aelio-hashing-256';

  embedSync(text: string): number[] {
    const v = new Array<number>(EMBED_DIM).fill(0);
    for (const tok of tokenize(text)) v[bucket(tok)]! += 1;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }

  async embed(text: string): Promise<number[]> {
    return this.embedSync(text);
  }
}

/** Real semantic embeddings via the OpenAI embeddings API. */
export class OpenAIEmbedder implements Embedder {
  readonly model: string;
  constructor(
    private readonly apiKey: string,
    model = 'text-embedding-3-small',
  ) {
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: text }),
      });
    } catch (err) {
      throw Errors.internal(`OpenAI embeddings failed: ${err instanceof Error ? err.message : 'network'}`);
    }
    if (!res.ok) throw Errors.internal(`OpenAI embeddings ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data[0]?.embedding ?? [];
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot;
}

/** Select the embedder from env: OpenAI when configured, else hashing. */
export function selectEmbedder(): { embedder: Embedder; seed: HashingEmbedder } {
  const seed = new HashingEmbedder();
  if (process.env.EMBEDDINGS_PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
    return { embedder: new OpenAIEmbedder(process.env.OPENAI_API_KEY, process.env.EMBEDDINGS_MODEL), seed };
  }
  return { embedder: seed, seed };
}
