export interface MemoryHit {
  episodeId: string;
  turnId?: string;
  conversationId: string;
  role: string;
  text: string;
  score: number;
  createdAt: Date;
  intentKey?: string;
  phase?: string;
}

export interface IndexTurnInput {
  turnId: string;
  tenantId: string;
  identityId: string;
  conversationId: string;
  role: string;
  text: string;
}

export interface IndexEpisodeInput {
  episodeId: string;
  tenantId: string;
  identityId: string;
  conversationId: string;
  intentKey: string;
  phase: string;
  body: string;
  startedAt: Date;
  endedAt: Date;
}

export interface SearchMemoryInput {
  tenantId: string;
  identityId: string;
  queryText: string;
  limit?: number;
  excludeTurnIds?: string[];
}

export interface RollupResult {
  l1: number;
  l2: number;
  l3: number;
}

/** Port for semantic memory — Postgres pgvector or SunJet hybrid index. */
export interface MemoryEngine {
  readonly name: 'postgres' | 'sunjet';
  indexTurn(input: IndexTurnInput): void;
  indexEpisode(input: IndexEpisodeInput): void;
  search(input: SearchMemoryInput): Promise<MemoryHit[]>;
  ensureReady(): Promise<void>;
  /** Compact lower layers into L1–L3 summaries (SunJet mode only). */
  rollupLayers?(): Promise<RollupResult>;
}