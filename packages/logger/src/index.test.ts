import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger } from './index.js';

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('child carries all context fields on every log line', () => {
    process.env.LOG_LEVEL = 'info';
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      writes.push(String(s));
      return true;
    });
    const log = createLogger({ tenantId: 't1' }).child({ conversationId: 'c1', traceId: 'tr1' });
    log.info({ latencyMs: 42 }, 'LLM call completed');
    expect(writes).toHaveLength(1);
    const line = JSON.parse(writes[0]!);
    expect(line).toMatchObject({
      level: 'info',
      tenantId: 't1',
      conversationId: 'c1',
      traceId: 'tr1',
      latencyMs: 42,
      msg: 'LLM call completed',
    });
    expect(line.time).toBeTypeOf('string');
  });
});
