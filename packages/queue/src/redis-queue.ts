import { Queue as BullQueue, Worker, type Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import type { Job, JobOptions, JobProcessor, JobPayloads, Queue, QueueName } from './index.js';

/**
 * BullMQ + Redis durable queue (the production swap for InMemoryQueue). Same
 * interface; jobs survive process restarts and are processed with BullMQ's
 * retry/backoff. Selected by `createQueueFor` when REDIS_URL is set.
 */
export class RedisQueue<N extends QueueName> implements Queue<N> {
  private queue: BullQueue;
  private connection: IORedis;
  private worker?: Worker;

  constructor(
    public readonly name: N,
    redisUrl: string,
  ) {
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new BullQueue(name, { connection: this.connection as never });
  }

  async add(data: JobPayloads[N], opts: JobOptions = {}): Promise<Job<N>> {
    const job = await this.queue.add(this.name, data, {
      priority: opts.priority ?? 10,
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return {
      id: String(job.id),
      name: this.name,
      data,
      attemptsMade: 0,
      enqueuedAt: Date.now(),
    };
  }

  process(handler: JobProcessor<N>): void {
    this.worker = new Worker(
      this.name,
      async (job: BullJob) => {
        await handler({
          id: String(job.id),
          name: this.name,
          data: job.data as JobPayloads[N],
          attemptsMade: job.attemptsMade,
          enqueuedAt: job.timestamp,
        });
      },
      { connection: this.connection as never },
    );
  }

  async depth(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  async drain(): Promise<void> {
    // Wait until no waiting/active jobs remain.
    for (let i = 0; i < 600; i++) {
      const [waiting, active] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
      ]);
      if (waiting + active === 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    await this.connection.quit();
  }
}
