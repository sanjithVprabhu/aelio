import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { decodeClientMessage } from '@aelio/convox-sdk';
import { applyConvoxFlowMessage, type Container } from '../container.js';

/** Map tenant API keys → tenant slug (demo + env). */
function resolveTenantId(c: Container, apiKey: string): string | undefined {
  if (apiKey === process.env.DEMO_CONVOX_API_KEY || apiKey === 'test_api_key') {
    const tenant = c.store.getTenantBySlug('acme');
    return tenant?.id;
  }
  return c.store.findTenantIdByApiKey(apiKey);
}

/**
 * Convox SDK stream — outbound WebSocket from customer backends.
 * Protocol: @aelio/convox-sdk v1.2 (`/v1/convox/stream`).
 */
export function registerConvoxRoutes(app: FastifyInstance, c: Container): void {
  app.get('/v1/convox/stream', { websocket: true }, (socket, req) => {
    const ws = socket as unknown as WebSocket;
    const auth = req.headers.authorization ?? '';
    const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const tenantId = resolveTenantId(c, apiKey);
    if (!tenantId) {
      ws.close(4401, 'unauthorized');
      return;
    }

    const instanceId = String(req.headers['x-convox-instance-id'] ?? 'unknown');
    const conn = c.convox.registerConnection({ tenantId, instanceId, socket: ws });

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        const message = decodeClientMessage(text);
        c.convox.applyClientMessage(conn.connectionId, message);
        c.convoxBridge.syncFromRegistry(tenantId);
        void c.convoxStateBridge.syncFromRegistry(tenantId);
        void applyConvoxFlowMessage(c, tenantId, message);
      } catch {
        c.convox.send(conn, { type: 'error', code: 'bad_message', message: 'Invalid frame.' });
      }
    });

    ws.on('close', () => {
      c.convox.removeConnection(conn.connectionId);
      c.convoxBridge.syncFromRegistry(tenantId);
      void c.convoxStateBridge.syncFromRegistry(tenantId);
      void applyConvoxFlowMessage(c, tenantId);
    });
  });
}