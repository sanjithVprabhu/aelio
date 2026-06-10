import { describe, it, expect } from 'vitest';
import { parseConfig } from './index.js';

describe('config', () => {
  it('returns fully typed object on valid env', () => {
    const r = parseConfig({ NODE_ENV: 'test', APP_NAME: 'api', PORT: '4000' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.APP_NAME).toBe('api');
      expect(r.config.PORT).toBe(4000);
      expect(r.config.LLM_PROVIDER).toBe('scripted');
    }
  });

  it('reports an error on an invalid enum value', () => {
    const r = parseConfig({ NODE_ENV: 'banana' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toContain('NODE_ENV');
  });

  it('applies dev defaults for encryption key in dev/test', () => {
    const r = parseConfig({ NODE_ENV: 'test' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.MASTER_ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(64);
  });
});
