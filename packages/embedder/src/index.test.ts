import { describe, it, expect } from 'vitest';
import {
  HashEmbedder,
  EMBEDDING_DIMENSIONS,
  createEmbedder,
  vectorLiteral,
} from './index.js';

describe('HashEmbedder', () => {
  it('returns normalized 1536-d vectors', async () => {
    const e = new HashEmbedder();
    const v = await e.embed('hello world');
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const e = new HashEmbedder();
    const a = await e.embed('cancel my subscription');
    const b = await e.embed('cancel my subscription');
    expect(a).toEqual(b);
  });

  it('similar text has higher cosine similarity than unrelated text', async () => {
    const e = new HashEmbedder();
    const q = await e.embed('what is my current plan');
    const plan = await e.embed('your plan is pro with five seats');
    const weather = await e.embed('sunny weather in tokyo today');
    const sim = (a: number[], b: number[]) =>
      a.reduce((s, v, i) => s + v * b[i]!, 0);
    expect(sim(q, plan)).toBeGreaterThan(sim(q, weather));
  });
});

describe('createEmbedder', () => {
  it('selects google when GEMINI_API_KEY is set', () => {
    const e = createEmbedder({
      GEMINI_API_KEY: 'test-gemini-key',
      EMBEDDING_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
    } as NodeJS.ProcessEnv);
    expect(e.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(e.constructor.name).toBe('GeminiEmbedder');
  });

  it('falls back to hash without any API keys', () => {
    const e = createEmbedder({} as NodeJS.ProcessEnv);
    expect(e.constructor.name).toBe('HashEmbedder');
  });
});

describe('vectorLiteral', () => {
  it('formats pgvector array syntax', () => {
    expect(vectorLiteral([1, 2.5])).toBe('[1,2.5]');
  });
});