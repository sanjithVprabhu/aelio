import { InMemoryQueue, type Queue, type QueueName } from './index.js';
import { RedisQueue } from './redis-queue.js';

/**
 * Return a Redis/BullMQ-backed queue when REDIS_URL is configured, else the
 * in-memory queue — so workers run with zero infra by default and durably in
 * production.
 */
export function createQueueFor<N extends QueueName>(name: N, redisUrl = process.env.REDIS_URL): Queue<N> {
  return redisUrl ? new RedisQueue(name, redisUrl) : new InMemoryQueue(name);
}
