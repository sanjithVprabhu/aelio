import { describe, it, expect } from 'vitest';
import { AppError, ErrorCode, Errors } from './index.js';

describe('errors', () => {
  it('actionTierViolation carries correct code and statusCode', () => {
    const e = Errors.actionTierViolation('cancel_subscription', 3);
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe(ErrorCode.ActionTierViolation);
    expect(e.statusCode).toBe(403);
    expect(e.details).toEqual({ action: 'cancel_subscription', tier: 3 });
  });

  it('rateLimited carries retryAfterMs in details', () => {
    const e = Errors.rateLimited(3600_000);
    expect(e.code).toBe(ErrorCode.RateLimitExceeded);
    expect(e.statusCode).toBe(429);
    expect(e.details).toEqual({ retryAfterMs: 3600_000 });
  });

  it('toJSON omits stack trace', () => {
    const e = Errors.forbidden('nope');
    const json = e.toJSON();
    expect(json).toEqual({ code: ErrorCode.Forbidden, message: 'nope', details: undefined });
    expect(JSON.stringify(json)).not.toContain('at ');
  });
});
