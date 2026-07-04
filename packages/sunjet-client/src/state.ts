import type { SunJetApiValue } from './types.js';
import { SunJetClient } from './client.js';

export const RUNTIME_STATE_TABLE = 'runtime_state';

export interface RuntimeStateRow {
  rowId: number;
  entryKey: string;
  value: string;
  expiresAt: number;
}

/** SunJet-backed KV/state operations for Aelio hot path. */
export class SunJetStateClient {
  private rowIdByKey = new Map<string, number>();
  private ready = false;

  constructor(private readonly client: SunJetClient) {}

  async ensureSchema(): Promise<void> {
    if (this.ready) return;
    const probe = await this.client.tableSchema(RUNTIME_STATE_TABLE).catch(() => null);
    if (!probe) {
      await this.client.createTable(RUNTIME_STATE_TABLE, [
        { name: 'entry_key', kind: 'utf8' },
        { name: 'value', kind: 'text' },
        { name: 'expires_at', kind: 'i64' },
      ]);
    }
    this.ready = true;
  }

  async get(entryKey: string): Promise<unknown | null> {
    await this.ensureSchema();
    const now = Date.now();
    const { rows } = await this.client.scan(RUNTIME_STATE_TABLE, {
      k: 1,
      filters: [
        { col: 'entry_key', op: 'eq', value: { type: 'utf8', value: entryKey } },
        { col: 'expires_at', op: 'ge', value: { type: 'i64', value: now } },
      ],
    });
    const row = rows[0];
    if (!row) return null;
    this.rowIdByKey.set(entryKey, row.rowId);
    const raw = row.values.value;
    const text = this.valueToString(raw);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async set(entryKey: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.ensureSchema();
    const expiresAt = Date.now() + (ttlSeconds ?? 86400) * 1000;
    const payload: Record<string, SunJetApiValue> = {
      entry_key: { type: 'utf8', value: entryKey },
      value: { type: 'utf8', value: JSON.stringify(value) },
      expires_at: { type: 'i64', value: expiresAt },
    };
    const cachedId = this.rowIdByKey.get(entryKey);
    if (cachedId) {
      const ok = await this.client.updateRow(RUNTIME_STATE_TABLE, cachedId, payload);
      if (ok) return;
    }
    const found = await this.findRowId(entryKey);
    if (found) {
      await this.client.updateRow(RUNTIME_STATE_TABLE, found, payload);
      this.rowIdByKey.set(entryKey, found);
      return;
    }
    const { row_id } = await this.client.insertRow(RUNTIME_STATE_TABLE, payload);
    this.rowIdByKey.set(entryKey, row_id);
  }

  async del(entryKey: string): Promise<void> {
    await this.ensureSchema();
    const id = this.rowIdByKey.get(entryKey) ?? (await this.findRowId(entryKey));
    if (id) {
      await this.client.deleteRow(RUNTIME_STATE_TABLE, id);
      this.rowIdByKey.delete(entryKey);
    }
  }

  async incr(entryKey: string, ttlSeconds = 3600): Promise<number> {
    const current = (await this.get(entryKey)) as number | null;
    const next = (typeof current === 'number' ? current : 0) + 1;
    await this.set(entryKey, next, ttlSeconds);
    return next;
  }

  private async findRowId(entryKey: string): Promise<number | undefined> {
    const now = Date.now();
    const { rows } = await this.client.scan(RUNTIME_STATE_TABLE, {
      k: 1,
      filters: [
        { col: 'entry_key', op: 'eq', value: { type: 'utf8', value: entryKey } },
        { col: 'expires_at', op: 'ge', value: { type: 'i64', value: now } },
      ],
    });
    const id = rows[0]?.rowId;
    if (id) this.rowIdByKey.set(entryKey, id);
    return id;
  }

  private valueToString(raw: SunJetApiValue | undefined): string {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return JSON.stringify(raw ?? '');
    if (raw.type === 'utf8' && 'value' in raw) return String(raw.value);
    if (raw.type === 'null') return 'null';
    return JSON.stringify(raw);
  }
}