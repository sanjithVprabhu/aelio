export * from './types.js';
export { PostgresMemoryAdapter } from './postgres-adapter.js';
export { SunJetMemoryAdapter, type EpisodeBodyStore } from './sunjet-adapter.js';

import type { Embedder } from '@aelio/embedder';
import type { DbConnection } from '@aelio/db';
import { SunJetClient } from '@aelio/sunjet-client';
import type { MemoryEngine } from './types.js';
import { PostgresMemoryAdapter } from './postgres-adapter.js';
import { SunJetMemoryAdapter, type EpisodeBodyStore } from './sunjet-adapter.js';

export interface CreateMemoryEngineInput {
  sql?: DbConnection['sql'];
  embedder: Embedder;
  sunjetUrl?: string;
  sunjetApiKey?: string;
  sunjetDaemonUrl?: string;
  bodies?: EpisodeBodyStore;
}

export function createMemoryEngine(input: CreateMemoryEngineInput): MemoryEngine | undefined {
  const mode = process.env.MEMORY_ENGINE ?? (input.sunjetUrl ? 'sunjet' : 'postgres');
  if (mode === 'sunjet' && input.sunjetUrl && input.bodies) {
    return new SunJetMemoryAdapter(
      new SunJetClient({
        baseUrl: input.sunjetUrl,
        apiKey: input.sunjetApiKey,
        daemonUrl: input.sunjetDaemonUrl,
      }),
      input.embedder,
      input.bodies,
    );
  }
  if (input.sql) {
    return new PostgresMemoryAdapter(input.sql, input.embedder);
  }
  return undefined;
}