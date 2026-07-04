import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { ActionTier } from '@aelio/types';
import { Store } from '../store/store.js';
import { ConvoxBridge } from './bridge.js';
import { ConvoxRegistry } from './registry.js';

function mockSocket(): WebSocket {
  return {
    OPEN: 1,
    readyState: 1,
    send: () => undefined,
  } as unknown as WebSocket;
}

describe('ConvoxBridge', () => {
  it('reflects live tool policies and prunes removed live tools', () => {
    const store = new Store();
    const registry = new ConvoxRegistry();
    const bridge = new ConvoxBridge(store, registry);

    const tenantId = 'tenant_1';
    const conn = registry.registerConnection({
      tenantId,
      instanceId: 'inst_1',
      socket: mockSocket(),
    });

    registry.applyClientMessage(conn.connectionId, {
      type: 'register',
      instanceId: 'inst_1',
      convoxVersion: '1.2.0',
      tenantId: 'acme',
      tools: [
        {
          key: 'cancel_subscription',
          description: 'Cancel the account',
          inputSchema: { type: 'object', properties: {} },
          policy: { tier: 3, stepUpRequired: true, rateLimitPerUserPerHour: 3 },
        },
      ],
      states: [],
      flows: [],
    });

    bridge.syncFromRegistry(tenantId);

    const action = store.getActionByKey(tenantId, 'cancel_subscription');
    expect(action).toBeTruthy();
    expect(action?.tier).toBe(ActionTier.Destructive);
    expect(action?.stepUpRequired).toBe(true);
    expect(action?.rateLimitPerUserPerHour).toBe(3);

    registry.applyClientMessage(conn.connectionId, {
      type: 'tool_remove',
      instanceId: 'inst_1',
      key: 'cancel_subscription',
    });

    bridge.syncFromRegistry(tenantId);
    expect(store.getActionByKey(tenantId, 'cancel_subscription')).toBeUndefined();
  });
});
