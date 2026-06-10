import { describe, it, expect } from 'vitest';
import { ActionTier, SpecFormat } from '@aelio/types';
import { detectFormat, parseGraphQL, parseMCP, parsePostman, parseRawDocs, parseSpec } from './parsers.js';

describe('spec parsers', () => {
  it('parses GraphQL queries as Tier 0 and mutations by naming', () => {
    const sdl = `type Query { account: Account } type Mutation { cancelSubscription(id: ID): Result updatePlan(plan: String): Result }`;
    const r = parseGraphQL(sdl);
    const cancel = r.parsedActions.find((a) => a.key === 'cancel_subscription')!;
    const account = r.parsedActions.find((a) => a.key === 'account')!;
    expect(account.suggestedTier).toBe(ActionTier.Read);
    expect(cancel.suggestedTier).toBe(ActionTier.Destructive);
  });

  it('parses an MCP tool list', () => {
    const raw = JSON.stringify([
      { name: 'get_status', description: 'read', inputSchema: { type: 'object', properties: {} } },
      { name: 'delete_thing', description: 'remove', inputSchema: { type: 'object', properties: {} } },
    ]);
    const r = parseMCP(raw);
    expect(r.parsedActions).toHaveLength(2);
    expect(r.parsedActions.find((a) => a.key === 'delete_thing')!.suggestedTier).toBe(ActionTier.Destructive);
  });

  it('parses a Postman collection with nested folders', () => {
    const raw = JSON.stringify({
      info: { name: 'C', _postman_id: 'x' },
      item: [{ name: 'Billing', item: [{ name: 'Get invoice', request: { method: 'GET', url: { raw: '/invoices/1' } } }] }],
    });
    const r = parsePostman(raw);
    expect(r.parsedActions[0]!.key).toBe('get_invoice');
    expect(r.parsedActions[0]!.tags).toContain('Billing');
  });

  it('extracts endpoints from raw docs and always warns', () => {
    const r = parseRawDocs('To fetch the user call GET /users/{id}. To remove it use DELETE /users/{id}.');
    expect(r.parsedActions.length).toBe(2);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('auto-detects format', () => {
    expect(detectFormat('{"openapi":"3.0.0","paths":{}}')).toBe(SpecFormat.OpenAPI3);
    expect(detectFormat('type Query { a: B }')).toBe(SpecFormat.GraphQL);
    expect(parseSpec('type Mutation { cancelX: R }').format).toBe(SpecFormat.GraphQL);
  });
});
