import type {
  SunJetColumnSpec,
  SunJetDaemonEnqueueRequest,
  SunJetHit,
  SunJetQueryRequest,
  SunJetApiValue,
} from './types.js';

export interface SunJetClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** SunJet daemon URL for push/outbox (optional). */
  daemonUrl?: string;
  daemonApiKey?: string;
  fetchImpl?: typeof fetch;
}

export class SunJetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SunJetError';
  }
}

/** HTTP client for SunJet ll-server and the companion daemon. */
export class SunJetClient {
  private readonly base: string;
  private readonly daemon?: string;
  private readonly apiKey?: string;
  private readonly daemonApiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SunJetClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.daemon = opts.daemonUrl?.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.daemonApiKey = opts.daemonApiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async health(): Promise<{ status: string }> {
    const res = await this.fetchImpl(`${this.base}/v1/health`);
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    return (await res.json()) as { status: string };
  }

  async createTable(name: string, columns: SunJetColumnSpec[]): Promise<{ table_id: number }> {
    return this.post(`/v1/tables`, { name, columns });
  }

  async insertRow(
    table: string,
    values: Record<string, import('./types.js').SunJetApiValue>,
  ): Promise<{ row_id: number }> {
    return this.post(`/v1/tables/${encodeURIComponent(table)}/rows`, { values });
  }

  async query(table: string, body: SunJetQueryRequest): Promise<{ results: SunJetHit[] }> {
    return this.post(`/v1/tables/${encodeURIComponent(table)}/query`, body);
  }

  async scan(
    table: string,
    body: SunJetQueryRequest,
  ): Promise<{ rows: Array<{ rowId: number; values: Record<string, SunJetApiValue> }> }> {
    const raw = await this.post<{
      rows: Array<{ row_id: number; values: Record<string, SunJetApiValue> }>;
    }>(`/v1/tables/${encodeURIComponent(table)}/scan`, body);
    return {
      rows: raw.rows.map((r) => ({ rowId: r.row_id, values: r.values })),
    };
  }

  async getRow(
    table: string,
    rowId: number,
  ): Promise<{ rowId: number; values: Record<string, SunJetApiValue> }> {
    const res = await this.fetchImpl(`${this.base}/v1/tables/${encodeURIComponent(table)}/rows/${rowId}`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) throw new SunJetError(404, 'row not found');
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    const raw = (await res.json()) as { row_id: number; values: Record<string, SunJetApiValue> };
    return { rowId: raw.row_id, values: raw.values };
  }

  async updateRow(
    table: string,
    rowId: number,
    values: Record<string, import('./types.js').SunJetApiValue>,
  ): Promise<boolean> {
    const res = await this.fetchImpl(
      `${this.base}/v1/tables/${encodeURIComponent(table)}/rows/${rowId}`,
      {
        method: 'PATCH',
        headers: this.headers(),
        body: JSON.stringify({ values }),
      },
    );
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    const raw = (await res.json()) as { applied: boolean };
    return raw.applied;
  }

  async deleteRow(table: string, rowId: number): Promise<boolean> {
    const res = await this.fetchImpl(
      `${this.base}/v1/tables/${encodeURIComponent(table)}/rows/${rowId}`,
      { method: 'DELETE', headers: this.authHeaders() },
    );
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    const raw = (await res.json()) as { applied: boolean };
    return raw.applied;
  }

  async tableSchema(table: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}/v1/tables/${encodeURIComponent(table)}/schema`, {
      headers: this.authHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    return res.json();
  }

  async flush(): Promise<{ ok: boolean }> {
    return this.post('/v1/admin/flush', {});
  }

  async compact(): Promise<{ ok: boolean }> {
    return this.post('/v1/admin/compact', {});
  }

  /** Idempotent bootstrap of the Aelio memory_l0 table. */
  async ensureMemoryL0Schema(dim: number): Promise<void> {
    await this.ensureMemoryTableSchema('memory_l0', [
      { name: 'tenant_id', kind: 'utf8' },
      { name: 'identity_id', kind: 'utf8' },
      { name: 'conversation_id', kind: 'utf8' },
      { name: 'intent_key', kind: 'utf8' },
      { name: 'phase', kind: 'utf8' },
      { name: 'body', kind: 'text' },
      { name: 'embedding', kind: 'vector', dim },
      { name: 'started_at', kind: 'i64' },
      { name: 'ended_at', kind: 'i64' },
    ]);
  }

  /** Idempotent bootstrap of memory_l1 / l2 / l3 summary layers. */
  async ensureMemoryLayersSchema(dim: number): Promise<void> {
    const layerColumns: SunJetColumnSpec[] = [
      { name: 'tenant_id', kind: 'utf8' },
      { name: 'identity_id', kind: 'utf8' },
      { name: 'body', kind: 'text' },
      { name: 'embedding', kind: 'vector', dim },
      { name: 'parent_edges', kind: 'utf8' },
    ];
    await Promise.all([
      this.ensureMemoryTableSchema('memory_l1', layerColumns),
      this.ensureMemoryTableSchema('memory_l2', layerColumns),
      this.ensureMemoryTableSchema('memory_l3', layerColumns),
    ]);
  }

  private async ensureMemoryTableSchema(name: string, columns: SunJetColumnSpec[]): Promise<void> {
    const probe = await this.fetchImpl(`${this.base}/v1/tables/${encodeURIComponent(name)}/schema`, {
      headers: this.headers(),
    });
    if (probe.ok) return;
    if (probe.status !== 404) {
      throw new SunJetError(probe.status, await probe.text());
    }
    await this.createTable(name, columns);
  }

  /** Enqueue a push/outbox job on the Rust SunJet daemon. */
  async daemonEnqueue(job: SunJetDaemonEnqueueRequest): Promise<{ queued: boolean }> {
    if (!this.daemon) return { queued: false };
    const res = await this.fetchImpl(`${this.daemon}/v1/outbox/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.daemonApiKey ? { Authorization: `Bearer ${this.daemonApiKey}` } : {}),
      },
      body: JSON.stringify({
        job_id: job.jobId,
        tenant_id: job.tenantId,
        identity_id: job.identityId,
        channel: job.channel,
        event_type: job.eventType,
        payload: job.payload,
        webhook_url: job.webhookUrl,
      }),
    });
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    return (await res.json()) as { queued: boolean };
  }

  async daemonHealth(): Promise<{ status: string } | null> {
    if (!this.daemon) return null;
    try {
      const headers: Record<string, string> = {};
      if (this.daemonApiKey) headers.Authorization = `Bearer ${this.daemonApiKey}`;
      const res = await this.fetchImpl(`${this.daemon}/v1/health`, { headers });
      if (!res.ok) return null;
      return (await res.json()) as { status: string };
    } catch {
      return null;
    }
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...this.authHeaders() };
  }

  private authHeaders(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new SunJetError(res.status, await res.text());
    return (await res.json()) as T;
  }
}
