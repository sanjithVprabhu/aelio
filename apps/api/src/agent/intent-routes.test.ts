import { describe, it, expect } from 'vitest';
import { matchDeterministicIntent } from './intent-routes.js';

describe('matchDeterministicIntent', () => {
  const keys = new Set([
    'list_team_members',
    'get_account_status',
    'get_invoice',
    'update_plan',
  ]);

  it('maps list team members', () => {
    expect(matchDeterministicIntent('list the team members', keys)?.toolKey).toBe(
      'list_team_members',
    );
  });

  it('maps plan questions to get_account_status', () => {
    expect(matchDeterministicIntent("what's my plan?", keys)?.toolKey).toBe('get_account_status');
  });

  it('returns null when tool not available', () => {
    expect(matchDeterministicIntent('list the team members', new Set(['get_invoice']))).toBeNull();
  });
});