const DEFAULT_DIMENSIONS = 1536;

export interface GeminiEmbedderOptions {
  apiKey: string;
  model?: string;
  dimensions?: number;
}

/** Google Gemini `embedContent` (gemini-embedding-001, 1536-d via outputDimensionality). */
export class GeminiEmbedder {
  readonly dimensions: number;

  constructor(private readonly opts: GeminiEmbedderOptions) {
    this.dimensions = opts.dimensions ?? DEFAULT_DIMENSIONS;
  }

  private get model(): string {
    return this.opts.model ?? 'gemini-embedding-001';
  }

  async embed(text: string): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.opts.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dimensions,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini embeddings failed (${res.status}): ${body.slice(0, 400)}`);
    }
    const json = (await res.json()) as { embedding?: { values?: number[] } };
    const embedding = json.embedding?.values;
    if (!embedding?.length) throw new Error('Gemini embeddings returned empty vector');
    if (embedding.length !== this.dimensions) {
      throw new Error(
        `Gemini embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`,
      );
    }
    return embedding;
  }
}