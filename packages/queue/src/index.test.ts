import { describe, it, expect } from 'vitest';
import { InMemoryQueue, QueueName } from './index.js';

describe('InMemoryQueue', () => {
  it('drains jobs pending together in priority order', async () => {
    const q = new InMemoryQueue(QueueName.SpecIngest);
    const seen: string[] = [];
    // Enqueue before attaching the worker → both pending together, sorted by priority.
    await q.add({ tenantId: 't', specId: 'low' }, { priority: 10 });
    await q.add({ tenantId: 't', specId: 'high' }, { priority: 1 });
    q.process(async (job) => {
      seen.push(job.data.specId);
    });
    await q.drain();
    expect(seen).toEqual(['high', 'low']);
  });

  it('retries a failing job up to its attempt limit', async () => {
    const q = new InMemoryQueue(QueueName.KbIndex);
    let attempts = 0;
    q.process(async () => {
      attempts++;
      if (attempts < 2) throw new Error('transient');
    });
    await q.add({ tenantId: 't', collectionId: 'c', sourceId: 's' }, { attempts: 3 });
    await q.drain();
    expect(attempts).toBe(2);
  });
});
