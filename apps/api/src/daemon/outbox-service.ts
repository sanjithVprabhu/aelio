import type { DbConnection } from '@aelio/db';
import { SunJetClient } from '@aelio/sunjet-client';
import { createLogger } from '@aelio/logger';
import { uuid } from '../util/id.js';
import type { ConvoxRegistry } from '../convox/registry.js';

const log = createLogger({ component: 'outbox' });

export interface OutboxJob {
  id: string;
  tenantId: string;
  identityId?: string;
  channel: 'convox_ws' | 'webhook';
  eventType: string;
  payload: Record<string, unknown>;
  webhookUrl?: string;
}

/** Durable outbox + delivery via Convox WS and SunJet daemon webhooks. */
export class OutboxService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sql: DbConnection['sql'] | undefined,
    private readonly convox: ConvoxRegistry,
    private readonly sunjet?: SunJetClient,
  ) {}

  start(intervalMs = 3_000): void {
    if (!this.sql || this.timer) return;
    this.timer = setInterval(() => {
      void this.flushPending().catch((err) => log.warn({ err }, 'outbox flush failed'));
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async enqueue(job: Omit<OutboxJob, 'id'>): Promise<string> {
    const id = uuid();
    if (this.sql) {
      await this.sql`
        INSERT INTO outbox_jobs (id, tenant_id, identity_id, channel, event_type, payload, webhook_url)
        VALUES (${id}, ${job.tenantId}, ${job.identityId ?? null}, ${job.channel}, ${job.eventType}, ${JSON.stringify(job.payload)}::jsonb, ${job.webhookUrl ?? null})
      `;
    }
    if (this.sunjet) {
      void this.sunjet
        .daemonEnqueue({
          jobId: id,
          tenantId: job.tenantId,
          identityId: job.identityId,
          channel: job.channel,
          eventType: job.eventType,
          payload: job.payload,
          webhookUrl: job.webhookUrl,
        })
        .catch((err) => log.warn({ err, id }, 'sunjet daemon enqueue failed'));
    }
    return id;
  }

  /** Push a proactive update to the customer Convox SDK. */
  async pushConvoxEvent(
    tenantId: string,
    input: { eventType: string; payload: Record<string, unknown>; identityId?: string },
  ): Promise<void> {
    await this.enqueue({
      tenantId,
      identityId: input.identityId,
      channel: 'convox_ws',
      eventType: input.eventType,
      payload: input.payload,
    });
    this.convox.pushEvent(tenantId, {
      type: 'push_event',
      eventType: input.eventType,
      payload: input.payload,
    });
  }

  private async flushPending(): Promise<void> {
    if (!this.sql) return;
    const rows = await this.sql<
      Array<{
        id: string;
        tenant_id: string;
        identity_id: string | null;
        channel: string;
        event_type: string;
        payload: Record<string, unknown>;
        webhook_url: string | null;
        attempts: number;
      }>
    >`
      SELECT id, tenant_id, identity_id, channel, event_type, payload, webhook_url, attempts
      FROM outbox_jobs
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 20
    `;

    for (const row of rows) {
      try {
        if (row.channel === 'convox_ws' && this.convox.hasLiveConnection(row.tenant_id)) {
          this.convox.pushEvent(row.tenant_id, {
            type: 'push_event',
            eventType: row.event_type,
            payload: row.payload,
          });
        }
        if (row.channel === 'webhook' && row.webhook_url) {
          await fetch(row.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventType: row.event_type,
              tenantId: row.tenant_id,
              identityId: row.identity_id,
              payload: row.payload,
            }),
          });
        }
        await this.sql`
          UPDATE outbox_jobs SET status = 'delivered', delivered_at = now() WHERE id = ${row.id}
        `;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.sql`
          UPDATE outbox_jobs SET attempts = ${row.attempts + 1}, last_error = ${msg} WHERE id = ${row.id}
        `;
      }
    }
  }
}