import type { DbConnection } from '@aelio/db';
import type { EpisodeBodyStore, IndexEpisodeInput, IndexTurnInput } from '@aelio/memory-engine';
import { uuid } from '../util/id.js';

/** Postgres pointer store for SunJet memory rows. */
export class PgEpisodeStore implements EpisodeBodyStore {
  constructor(private readonly sql: DbConnection['sql']) {}

  putEpisode(input: IndexEpisodeInput & { sunjetRowId?: number }): void {
    void this.sql`
      INSERT INTO memory_episodes (
        id, tenant_id, identity_id, conversation_id, layer,
        intent_key, phase, body, sunjet_row_id, started_at, ended_at
      ) VALUES (
        ${input.episodeId},
        ${input.tenantId},
        ${input.identityId},
        ${input.conversationId},
        'l0',
        ${input.intentKey},
        ${input.phase},
        ${input.body},
        ${input.sunjetRowId ?? null},
        ${input.startedAt},
        ${input.endedAt}
      )
      ON CONFLICT (id) DO NOTHING
    `.catch(() => undefined);
  }

  putTurnMapping(input: IndexTurnInput & { sunjetRowId: number }): void {
    void this.sql`
      INSERT INTO memory_episodes (
        id, tenant_id, identity_id, conversation_id, layer,
        intent_key, phase, body, sunjet_row_id, turn_id, created_at
      ) VALUES (
        ${uuid()},
        ${input.tenantId},
        ${input.identityId},
        ${input.conversationId},
        'l0',
        '_turn',
        ${input.role},
        ${input.text},
        ${input.sunjetRowId},
        ${input.turnId},
        now()
      )
    `.catch(() => undefined);
  }

  async getEpisodesByRowIds(
    tenantId: string,
    identityId: string,
    rowIds: number[],
  ): Promise<
    Array<{
      rowId: number;
      episodeId: string;
      body: string;
      conversationId: string;
      intentKey: string;
      phase: string;
      createdAt: Date;
    }>
  > {
    if (!rowIds.length) return [];
    const rows = await this.sql<
      Array<{
        sunjet_row_id: string;
        id: string;
        body: string;
        conversation_id: string;
        intent_key: string;
        phase: string;
        created_at: Date;
      }>
    >`
      SELECT sunjet_row_id, id, body, conversation_id, intent_key, phase, created_at
      FROM memory_episodes
      WHERE tenant_id = ${tenantId}
        AND identity_id = ${identityId}
        AND sunjet_row_id = ANY(${rowIds}::bigint[])
        AND turn_id IS NULL
    `;
    return rows.map((r) => ({
      rowId: Number(r.sunjet_row_id),
      episodeId: r.id,
      body: r.body,
      conversationId: r.conversation_id,
      intentKey: r.intent_key,
      phase: r.phase,
      createdAt: new Date(r.created_at),
    }));
  }

  async getTurnsByRowIds(
    tenantId: string,
    identityId: string,
    rowIds: number[],
  ): Promise<
    Array<{
      rowId: number;
      turnId: string;
      body: string;
      conversationId: string;
      role: string;
      createdAt: Date;
    }>
  > {
    if (!rowIds.length) return [];
    const rows = await this.sql<
      Array<{
        sunjet_row_id: string;
        turn_id: string;
        body: string;
        conversation_id: string;
        phase: string;
        created_at: Date;
      }>
    >`
      SELECT sunjet_row_id, turn_id, body, conversation_id, phase, created_at
      FROM memory_episodes
      WHERE tenant_id = ${tenantId}
        AND identity_id = ${identityId}
        AND sunjet_row_id = ANY(${rowIds}::bigint[])
        AND turn_id IS NOT NULL
    `;
    return rows.map((r) => ({
      rowId: Number(r.sunjet_row_id),
      turnId: r.turn_id,
      body: r.body,
      conversationId: r.conversation_id,
      role: r.phase,
      createdAt: new Date(r.created_at),
    }));
  }
}