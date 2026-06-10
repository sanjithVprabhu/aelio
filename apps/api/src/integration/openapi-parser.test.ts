import { describe, it, expect } from 'vitest';
import { ActionTier } from '@aelio/types';
import { parseOpenAPI } from './openapi-parser.js';
import { SAMPLE_OPENAPI } from '../seed/sample-spec.js';

describe('parseOpenAPI', () => {
  it('parses every path×method into an action with a tier', () => {
    const r = parseOpenAPI(SAMPLE_OPENAPI);
    expect(r.errors).toHaveLength(0);
    const keys = r.parsedActions.map((a) => a.key);
    expect(keys).toContain('get_account_status');
    expect(keys).toContain('cancel_subscription');
    const cancel = r.parsedActions.find((a) => a.key === 'cancel_subscription')!;
    expect(cancel.suggestedTier).toBe(ActionTier.Destructive);
    const status = r.parsedActions.find((a) => a.key === 'get_account_status')!;
    expect(status.suggestedTier).toBe(ActionTier.Read);
  });

  it('derives input schema from request body required fields', () => {
    const r = parseOpenAPI(SAMPLE_OPENAPI);
    const update = r.parsedActions.find((a) => a.key === 'update_plan')!;
    const required = (update.inputSchema as { required?: string[] }).required ?? [];
    expect(required).toContain('plan');
  });

  it('reports a clear error on non-JSON input', () => {
    const r = parseOpenAPI('not: valid: json');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.parsedActions).toHaveLength(0);
  });
});
