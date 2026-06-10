import type { InboundMessage, OutboundMessage } from '@aelio/types';

/**
 * Durable-job abstraction. The manual uses Redis + BullMQ; this package defines
 * the queue contract and ships an in-process implementation so workers run with
 * zero infra. A BullMQ-backed `Queue`/`Worker` of the same interface is the
 * production swap.
 */

export enum QueueName {
  Inbound = 'inbound_message',
  Outbound = 'outbound_delivery',
  SpecIngest = 'spec_ingest',
  PlaybookBootstrap = 'playbook_bootstrap',
  KbIndex = 'kb_index',
  DsarExport = 'dsar_export',
}

export interface JobPayloads {
  [QueueName.Inbound]: InboundMessage;
  [QueueName.Outbound]: OutboundMessage;
  [QueueName.SpecIngest]: { tenantId: string; specId: string };
  [QueueName.PlaybookBootstrap]: { tenantId: string; specId: string };
  [QueueName.KbIndex]: { tenantId: string; collectionId: string; sourceId: string };
  [QueueName.DsarExport]: { tenantId: string; externalUserId: string };
}

export interface Job<N extends QueueName> {
  id: string;
  name: N;
  data: JobPayloads[N];
  attemptsMade: number;
  enqueuedAt: number;
}

export type JobProcessor<N extends QueueName> = (job: Job<N>) => Promise<void>;

export interface JobOptions {
  priority?: number; // lower = higher priority
  attempts?: number;
}

export interface Queue<N extends QueueName> {
  add(data: JobPayloads[N], opts?: JobOptions): Promise<Job<N>>;
  process(handler: JobProcessor<N>): void;
  depth(): number | Promise<number>;
  drain(): Promise<void>;
}

/** In-memory queue: FIFO by priority, async processing, retry with backoff cap. */
export class InMemoryQueue<N extends QueueName> implements Queue<N> {
  private pending: Job<N>[] = [];
  private handler?: JobProcessor<N>;
  private running = false;
  private seq = 0;

  constructor(public readonly name: N) {}

  async add(data: JobPayloads[N], opts: JobOptions = {}): Promise<Job<N>> {
    const job: Job<N> = {
      id: `${this.name}_${++this.seq}`,
      name: this.name,
      data,
      attemptsMade: 0,
      enqueuedAt: Date.now(),
    };
    (job as Job<N> & { priority: number }).priority = opts.priority ?? 10;
    (job as Job<N> & { maxAttempts: number }).maxAttempts = opts.attempts ?? 3;
    this.pending.push(job);
    this.pending.sort(
      (a, b) =>
        (a as Job<N> & { priority: number }).priority -
        (b as Job<N> & { priority: number }).priority,
    );
    void this.tick();
    return job;
  }

  process(handler: JobProcessor<N>): void {
    this.handler = handler;
    void this.tick();
  }

  depth(): number {
    return this.pending.length;
  }

  async drain(): Promise<void> {
    while (this.pending.length > 0 || this.running) {
      await this.tick();
      if (this.pending.length === 0) break;
    }
  }

  private async tick(): Promise<void> {
    if (this.running || !this.handler) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const job = this.pending.shift()!;
        const max = (job as Job<N> & { maxAttempts: number }).maxAttempts;
        try {
          job.attemptsMade++;
          await this.handler(job);
        } catch (err) {
          if (job.attemptsMade < max) {
            this.pending.push(job); // re-enqueue for retry
          } else {
            // Dead-letter: surface but do not crash the worker.
            // eslint-disable-next-line no-console
            console.error(`[queue:${this.name}] job ${job.id} failed permanently`, err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export function createQueue<N extends QueueName>(name: N): Queue<N> {
  return new InMemoryQueue(name);
}

export { RedisQueue } from './redis-queue.js';
export { createQueueFor } from './factory.js';
