import { describe, it, expect } from 'vitest';
import { ActionTier } from '@aelio/types';
import { inferTier } from './tiering.js';

describe('inferTier', () => {
  it('GET → Read (Tier 0)', () => {
    expect(inferTier('GET', 'get_account_status')).toBe(ActionTier.Read);
  });
  it('POST → Reversible write (Tier 1)', () => {
    expect(inferTier('POST', 'schedule_report')).toBe(ActionTier.ReversibleWrite);
  });
  it('PUT/PATCH → State update (Tier 2)', () => {
    expect(inferTier('PUT', 'update_plan')).toBe(ActionTier.StateUpdate);
    expect(inferTier('PATCH', 'update_settings')).toBe(ActionTier.StateUpdate);
  });
  it('destructive verb → Destructive (Tier 3) regardless of method', () => {
    expect(inferTier('POST', 'cancel_subscription')).toBe(ActionTier.Destructive);
    expect(inferTier('DELETE', 'delete_account')).toBe(ActionTier.Destructive);
  });
  it('financial POST → Destructive (Tier 3)', () => {
    expect(inferTier('POST', 'create_payment')).toBe(ActionTier.Destructive);
  });
});
