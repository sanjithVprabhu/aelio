/** Shared E2E environment — requires Postgres + SunJet + Gemini. */
export function hasFullStackEnv(): boolean {
  return !!(
    process.env.DATABASE_URL &&
    process.env.SUNJET_URL &&
    (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY)
  );
}

export function configureGeminiStackEnv(): void {
  process.env.MEMORY_ENGINE = 'sunjet';
  process.env.CONVOX_IN_PROCESS = '0';
  process.env.LLM_PROVIDER = 'google';
  process.env.EMBEDDING_PROVIDER = 'google';
  process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001';
  process.env.LLM_MODEL = process.env.LLM_MODEL ?? 'gemini-2.5-flash';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function magicToken(url?: string): string {
  return url ? url.split('/').pop()! : '';
}

export async function waitFor(pred: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await sleep(50);
  }
}