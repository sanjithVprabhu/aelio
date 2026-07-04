import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CONVOX_STREAM_PATH,
  decodeClientMessage,
  encodeMessage,
  type ClientMessage,
} from '../protocol.js';
import { signExecuteToken } from '../token.js';
import type { ExecuteContext, FlowManifest, StateManifest, ToolManifest } from '../types.js';

export interface MockAelioServerOptions {
  /** Tenant API keys accepted on connect. */
  apiKeys?: Record<string, string>;
  /** Called for every inbound client message (testing introspection). */
  onMessage?: (tenantId: string, message: ClientMessage) => void;
}

export interface MockConnection {
  connectionId: string;
  tenantId: string;
  instanceId: string;
  tools: ToolManifest[];
  states: StateManifest[];
  flows: FlowManifest[];
  ws: WebSocket;
}

/**
 * Minimal in-process Aelio Convox stream for local tests and customer integration
 * harnesses until the real Aelio server endpoint ships.
 */
export class MockAelioServer {
  private http: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private readonly connections = new Map<string, MockConnection>();
  private readonly apiKeyToTenant = new Map<string, string>();

  constructor(private readonly opts: MockAelioServerOptions = {}) {
    for (const [tenantId, apiKey] of Object.entries(opts.apiKeys ?? { acme: 'test_api_key' })) {
      this.apiKeyToTenant.set(apiKey, tenantId);
    }
  }

  get url(): string {
    if (!this.http) throw new Error('MockAelioServer is not listening.');
    const addr = this.http.address();
    if (!addr || typeof addr === 'string') throw new Error('Unexpected server address.');
    return `http://127.0.0.1:${addr.port}`;
  }

  async listen(port = 0): Promise<number> {
    if (this.http) throw new Error('MockAelioServer is already listening.');

    const http = createServer();
    const wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith(CONVOX_STREAM_PATH)) {
        socket.destroy();
        return;
      }

      const auth = req.headers.authorization ?? '';
      const apiKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const tenantId = this.apiKeyToTenant.get(apiKey);
      if (!tenantId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, req, tenantId);
      });
    });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage, tenantId: string) => {
      const instanceId = String(req.headers['x-convox-instance-id'] ?? 'unknown');
      const connectionId = `conn_${Math.random().toString(36).slice(2, 10)}`;
      const conn: MockConnection = {
        connectionId,
        tenantId,
        instanceId,
        tools: [],
        states: [],
        flows: [],
        ws,
      };
      this.connections.set(connectionId, conn);

      ws.on('message', (data: RawData) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        try {
          const message = decodeClientMessage(text);
          this.opts.onMessage?.(tenantId, message);
          this.handleClientMessage(conn, message, apiKey);
        } catch {
          ws.send(encodeMessage({ type: 'error', code: 'bad_message', message: 'Invalid message.' }));
        }
      });

      ws.on('close', () => {
        this.connections.delete(connectionId);
      });

      const apiKey = [...this.apiKeyToTenant.entries()].find(([, t]) => t === tenantId)?.[0] ?? '';
      void apiKey;
    });

    await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
    this.http = http;
    this.wss = wss;
    const addr = http.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind mock server.');
    return addr.port;
  }

  async close(): Promise<void> {
    const closing = [...this.connections.values()].map(
      (conn) =>
        new Promise<void>((resolve) => {
          if (conn.ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            conn.ws.terminate();
            resolve();
          }, 500);
          conn.ws.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          conn.ws.close(1000, 'mock_shutdown');
        }),
    );
    await Promise.all(closing);
    this.connections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
    }
    if (this.http) {
      await new Promise<void>((resolve) => this.http?.close(() => resolve()));
    }
    this.wss = null;
    this.http = null;
  }

  listConnections(): MockConnection[] {
    return [...this.connections.values()];
  }

  toolsForTenant(tenantId: string): ToolManifest[] {
    const merged = new Map<string, ToolManifest>();
    for (const conn of this.connections.values()) {
      if (conn.tenantId !== tenantId) continue;
      for (const tool of conn.tools) merged.set(tool.key, tool);
    }
    return [...merged.values()];
  }

  flowsForTenant(tenantId: string): FlowManifest[] {
    const merged = new Map<string, FlowManifest>();
    for (const conn of this.connections.values()) {
      if (conn.tenantId !== tenantId) continue;
      for (const flow of conn.flows) {
        merged.set(`${flow.stateKey}:${flow.objectiveKey}`, flow);
      }
    }
    return [...merged.values()];
  }

  /** Push an execute frame to the first healthy connection for a tenant. */
  async execute(
    tenantId: string,
    input: {
      tool: string;
      args: Record<string, unknown>;
      context: ExecuteContext;
      apiKey: string;
    },
  ): Promise<unknown> {
    const conn = [...this.connections.values()].find((c) => c.tenantId === tenantId);
    if (!conn) throw new Error(`No Convox connection for tenant '${tenantId}'.`);

    const invocationId = input.context.invocationId;
    const token = signExecuteToken(input.apiKey, {
      tenantId,
      invocationId,
      tool: input.tool,
      context: input.context,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Execute timed out waiting for SDK response.'));
      }, 10_000);

      const onMessage = (data: WebSocket.RawData) => {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        let parsed: { type?: string; invocationId?: string; data?: unknown; error?: { message: string } };
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (parsed.invocationId !== invocationId) return;
        if (parsed.type === 'execute_result') {
          cleanup();
          resolve(parsed.data);
        } else if (parsed.type === 'execute_error') {
          cleanup();
          reject(new Error(parsed.error?.message ?? 'Execute failed.'));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        conn.ws.off('message', onMessage);
      };

      conn.ws.on('message', onMessage);
      conn.ws.send(
        encodeMessage({
          type: 'execute',
          invocationId,
          tool: input.tool,
          args: input.args,
          context: input.context,
          token,
        }),
      );
    });
  }

  private handleClientMessage(conn: MockConnection, message: ClientMessage, apiKey: string): void {
    switch (message.type) {
      case 'register':
        conn.tools = message.tools;
        conn.states = message.states ?? [];
        conn.flows = message.flows ?? [];
        conn.ws.send(encodeMessage({ type: 'registered', connectionId: conn.connectionId }));
        break;
      case 'state_upsert': {
        const sidx = conn.states.findIndex((s) => s.key === message.state.key);
        if (sidx >= 0) conn.states[sidx] = message.state;
        else conn.states.push(message.state);
        break;
      }
      case 'state_remove':
        conn.states = conn.states.filter((s) => s.key !== message.key);
        break;
      case 'tool_upsert': {
        const idx = conn.tools.findIndex((t) => t.key === message.tool.key);
        if (idx >= 0) conn.tools[idx] = message.tool;
        else conn.tools.push(message.tool);
        break;
      }
      case 'tool_remove':
        conn.tools = conn.tools.filter((t) => t.key !== message.key);
        break;
      case 'flow_upsert': {
        const fidx = conn.flows.findIndex(
          (f) => f.stateKey === message.flow.stateKey && f.objectiveKey === message.flow.objectiveKey,
        );
        if (fidx >= 0) conn.flows[fidx] = message.flow;
        else conn.flows.push(message.flow);
        break;
      }
      case 'flow_remove':
        conn.flows = conn.flows.filter(
          (f) => !(f.stateKey === message.stateKey && f.objectiveKey === message.objectiveKey),
        );
        break;
      case 'heartbeat':
        conn.ws.send(encodeMessage({ type: 'pong', ts: message.ts }));
        break;
      case 'execute_result':
      case 'execute_error':
        break;
      default:
        conn.ws.send(
          encodeMessage({ type: 'error', code: 'unknown_type', message: 'Unhandled client message.' }),
        );
    }
    void apiKey;
  }
}
