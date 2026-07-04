import { GeminiEmbedder } from './gemini.js';
import { resolveGeminiApiKey } from './keys.js';

export { GeminiEmbedder } from './gemini.js';
export { resolveGeminiApiKey } from './keys.js';

export const EMBEDDING_DIMENSIONS = 1536;

export interface Embedder {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/** Deterministic local embedder for tests and offline dev (no API key). */
export class HashEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(text: string): Promise<number[]> {
    const vec = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      const idx = (code * 31 + i * 17) % this.dimensions;
      vec[idx]! += 1;
    }
    // Token-ish features for short keywords
    for (const token of normalized.split(/\s+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < token.length; i++) h = (h * 33 + token.charCodeAt(i)) >>> 0;
      vec[h % this.dimensions]! += 2;
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    norm = Math.sqrt(norm) || 1;
    return Array.from(vec, (v) => v / norm);
  }
}

/** OpenAI `text-embedding-3-small` (1536 dimensions). */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const embedding = json.data?.[0]?.embedding;
    if (!embedding?.length) throw new Error('OpenAI embeddings returned empty vector');
    return embedding;
  }
}

export function createEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder {
  const geminiKey = resolveGeminiApiKey(env);
  const provider =
    env.EMBEDDING_PROVIDER ??
    (geminiKey ? 'google' : env.OPENAI_API_KEY ? 'openai' : 'hash');

  if (provider === 'google' || provider === 'gemini') {
    const key = resolveGeminiApiKey(env);
    if (!key) throw new Error('EMBEDDING_PROVIDER=google requires GEMINI_API_KEY');
    return new GeminiEmbedder({
      apiKey: key,
      model: env.EMBEDDING_MODEL ?? 'gemini-embedding-001',
    });
  }
  if (provider === 'openai') {
    const key = env.OPENAI_API_KEY;
    if (!key) throw new Error('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY');
    return new OpenAIEmbedder(key);
  }
  return new HashEmbedder();
}

/** Serialize a float vector for Postgres pgvector literals. */
export function vectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}