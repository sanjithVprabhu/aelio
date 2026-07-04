/** Type-tagged column value on the SunJet (ll-server) wire. */
export type SunJetApiValue =
  | { type: 'null' }
  | { type: 'bool'; value: boolean }
  | { type: 'i64'; value: number }
  | { type: 'f64'; value: number }
  | { type: 'utf8'; value: string }
  | { type: 'vector'; value: number[] }
  | { type: 'embed'; value: string };

export interface SunJetColumnSpec {
  name: string;
  kind: 'bool' | 'i64' | 'f64' | 'utf8' | 'timestamp' | 'text' | 'edge' | 'vector';
  dim?: number;
}

export interface SunJetQueryRequest {
  k: number;
  vector?: { col: string; query: number[] };
  semantic?: { col: string; text: string };
  text?: { col: string; query: string };
  filters?: Array<{ col: string; op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le'; value: SunJetApiValue }>;
  graph?: { col: string; seeds: number[]; depth: number };
}

export interface SunJetHit {
  row_id: number;
  score: number;
  values?: Record<string, SunJetApiValue>;
}

export interface SunJetDaemonEnqueueRequest {
  jobId: string;
  tenantId: string;
  identityId?: string;
  channel: 'convox_ws' | 'webhook';
  eventType: string;
  payload: Record<string, unknown>;
  webhookUrl?: string;
}
