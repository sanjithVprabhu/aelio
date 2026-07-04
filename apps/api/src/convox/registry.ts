import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  ClientMessage,
  ExecuteContext,
  FlowManifest,
  ServerMessage,
  StateManifest,
  ToolManifest,
} from '@aelio/convox-sdk';
import { encodeMessage, signExecuteToken } from '@aelio/convox-sdk';

export type InProcessHandler = (
  ctx: ExecuteContext,
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

function flowKey(stateKey: string, objectiveKey: string): string {
  return `${stateKey}:${objectiveKey}`;
}

export interface ConvoxConnection {
  connectionId: string;
  tenantId: string;
  instanceId: string;
  socket: WebSocket;
  tools: Map<string, ToolManifest>;
  states: Map<string, StateManifest>;
  flows: Map<string, FlowManifest>;
  lastHeartbeatAt: number;
}

/**
 * In-memory registry of live Convox SDK WebSocket connections per tenant.
 * Tool catalogs are merged from all healthy connections for a tenant.
 */
export class ConvoxRegistry {
  private readonly byConnection = new Map<string, ConvoxConnection>();
  private readonly byTenant = new Map<string, Set<string>>();
  /** Test/dev handlers without a live WebSocket (same execute contract). */
  private readonly inProcess = new Map<string, Map<string, InProcessHandler>>();
  private readonly inProcessManifests = new Map<string, Map<string, ToolManifest>>();
  private readonly inProcessStates = new Map<string, Map<string, StateManifest>>();
  private readonly inProcessFlows = new Map<string, Map<string, FlowManifest>>();
  /** Durable catalog loaded from Postgres (merged at read time). */
  private readonly diskStates = new Map<string, Map<string, StateManifest>>();

  registerConnection(input: {
    tenantId: string;
    instanceId: string;
    socket: WebSocket;
  }): ConvoxConnection {
    const connectionId = `conn_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const conn: ConvoxConnection = {
      connectionId,
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      socket: input.socket,
      tools: new Map(),
      states: new Map(),
      flows: new Map(),
      lastHeartbeatAt: Date.now(),
    };
    this.byConnection.set(connectionId, conn);
    let set = this.byTenant.get(input.tenantId);
    if (!set) {
      set = new Set();
      this.byTenant.set(input.tenantId, set);
    }
    set.add(connectionId);
    return conn;
  }

  removeConnection(connectionId: string): void {
    const conn = this.byConnection.get(connectionId);
    if (!conn) return;
    this.byConnection.delete(connectionId);
    this.byTenant.get(conn.tenantId)?.delete(connectionId);
  }

  get(connectionId: string): ConvoxConnection | undefined {
    return this.byConnection.get(connectionId);
  }

  listConnections(tenantId: string): ConvoxConnection[] {
    const ids = this.byTenant.get(tenantId);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.byConnection.get(id))
      .filter((c): c is ConvoxConnection => !!c);
  }

  registerDiskStates(tenantId: string, states: StateManifest[]): void {
    let map = this.diskStates.get(tenantId);
    if (!map) {
      map = new Map();
      this.diskStates.set(tenantId, map);
    }
    for (const state of states) map.set(state.key, state);
  }

  /** Merged state catalog: live WS + in-process + disk. */
  listStates(tenantId: string): StateManifest[] {
    const merged = new Map<string, StateManifest>();
    for (const state of this.diskStates.get(tenantId)?.values() ?? []) {
      merged.set(state.key, state);
    }
    for (const conn of this.listConnections(tenantId)) {
      for (const state of conn.states.values()) merged.set(state.key, state);
    }
    for (const state of this.inProcessStates.get(tenantId)?.values() ?? []) {
      merged.set(state.key, state);
    }
    return [...merged.values()];
  }

  /** Whether tools can be executed (live WS or in-process handlers). */
  hasLiveConnection(tenantId: string): boolean {
    return (
      this.listConnections(tenantId).length > 0 ||
      (this.inProcess.get(tenantId)?.size ?? 0) > 0
    );
  }

  /** Push a server-initiated event to all live connections for a tenant. */
  pushEvent(tenantId: string, event: ServerMessage): void {
    for (const conn of this.listConnections(tenantId)) {
      this.send(conn, event);
    }
  }

  registerInProcessStates(tenantId: string, states: StateManifest[]): void {
    let map = this.inProcessStates.get(tenantId);
    if (!map) {
      map = new Map();
      this.inProcessStates.set(tenantId, map);
    }
    for (const state of states) map.set(state.key, state);
  }

  registerInProcessFlows(tenantId: string, flows: FlowManifest[]): void {
    let map = this.inProcessFlows.get(tenantId);
    if (!map) {
      map = new Map();
      this.inProcessFlows.set(tenantId, map);
    }
    for (const flow of flows) {
      map.set(flowKey(flow.stateKey, flow.objectiveKey), flow);
    }
  }

  /** Merged flow catalog: live WS + in-process. */
  listFlows(tenantId: string): FlowManifest[] {
    const merged = new Map<string, FlowManifest>();
    for (const conn of this.listConnections(tenantId)) {
      for (const flow of conn.flows.values()) {
        merged.set(flowKey(flow.stateKey, flow.objectiveKey), flow);
      }
    }
    for (const flow of this.inProcessFlows.get(tenantId)?.values() ?? []) {
      merged.set(flowKey(flow.stateKey, flow.objectiveKey), flow);
    }
    return [...merged.values()];
  }

  /** Merged tool catalog from all live connections for a tenant. */
  listTools(tenantId: string): ToolManifest[] {
    const merged = new Map<string, ToolManifest>();
    for (const conn of this.listConnections(tenantId)) {
      for (const tool of conn.tools.values()) merged.set(tool.key, tool);
    }
    for (const tool of this.inProcessManifests.get(tenantId)?.values() ?? []) {
      merged.set(tool.key, tool);
    }
    return [...merged.values()];
  }

  hasOnlineTools(tenantId: string, key: string): boolean {
    return (
      this.listConnections(tenantId).some((c) => c.tools.has(key)) ||
      this.inProcess.get(tenantId)?.has(key) === true
    );
  }

  /**
   * Register in-process handlers (unit tests / local dev without a separate customer app).
   * Tools still flow through {@link ConvoxBridge} when syncFromRegistry runs.
   */
  registerInProcess(
    tenantId: string,
    tools: ToolManifest[],
    handlers: Record<string, InProcessHandler>,
  ): void {
    let map = this.inProcess.get(tenantId);
    if (!map) {
      map = new Map();
      this.inProcess.set(tenantId, map);
    }
    let manifests = this.inProcessManifests.get(tenantId);
    if (!manifests) {
      manifests = new Map();
      this.inProcessManifests.set(tenantId, manifests);
    }
    for (const tool of tools) {
      map.set(tool.key, handlers[tool.key]!);
      manifests.set(tool.key, tool);
    }
  }

  applyClientMessage(connectionId: string, message: ClientMessage): void {
    const conn = this.byConnection.get(connectionId);
    if (!conn) return;

    switch (message.type) {
      case 'register':
        conn.tools.clear();
        for (const tool of message.tools) conn.tools.set(tool.key, tool);
        conn.states.clear();
        for (const state of message.states ?? []) conn.states.set(state.key, state);
        conn.flows.clear();
        for (const flow of message.flows ?? []) {
          conn.flows.set(flowKey(flow.stateKey, flow.objectiveKey), flow);
        }
        this.send(conn, { type: 'registered', connectionId: conn.connectionId });
        break;
      case 'tool_upsert':
        conn.tools.set(message.tool.key, message.tool);
        break;
      case 'tool_remove':
        conn.tools.delete(message.key);
        break;
      case 'state_upsert':
        conn.states.set(message.state.key, message.state);
        break;
      case 'state_remove':
        conn.states.delete(message.key);
        break;
      case 'flow_upsert':
        conn.flows.set(
          flowKey(message.flow.stateKey, message.flow.objectiveKey),
          message.flow,
        );
        break;
      case 'flow_remove':
        conn.flows.delete(flowKey(message.stateKey, message.objectiveKey));
        break;
      case 'heartbeat':
        conn.lastHeartbeatAt = Date.now();
        this.send(conn, { type: 'pong', ts: message.ts });
        break;
      default:
        break;
    }
  }

  send(conn: ConvoxConnection, message: ServerMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.send(encodeMessage(message));
    }
  }

  /** Execute a tool on the first healthy connection for the tenant. */
  async execute(
    tenantId: string,
    apiKey: string,
    input: {
      tool: string;
      args: Record<string, unknown>;
      context: {
        invocationId: string;
        tenantId: string;
        externalUserId: string;
        email?: string;
        verified: boolean;
        stepUpValid: boolean;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };
    },
    timeoutMs = 10_000,
  ): Promise<unknown> {
    const inProc = this.inProcess.get(tenantId)?.get(input.tool);
    if (inProc) {
      return Promise.resolve(inProc(input.context, input.args));
    }

    const conn = this.listConnections(tenantId).find((c) => c.tools.has(input.tool));
    if (!conn) {
      throw new Error(`No online Convox handler for tool '${input.tool}'.`);
    }

    const token = signExecuteToken(apiKey, {
      tenantId: input.context.tenantId,
      invocationId: input.context.invocationId,
      tool: input.tool,
      context: input.context,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Convox execute timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      const onMessage = (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
        let parsed: {
          type?: string;
          invocationId?: string;
          data?: unknown;
          error?: { message?: string };
        };
        try {
          parsed = JSON.parse(text);
        } catch {
          return;
        }
        if (parsed.invocationId !== input.context.invocationId) return;
        if (parsed.type === 'execute_result') {
          cleanup();
          resolve(parsed.data);
        } else if (parsed.type === 'execute_error') {
          cleanup();
          reject(new Error(parsed.error?.message ?? 'Convox execute failed.'));
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        conn.socket.off('message', onMessage);
      };

      conn.socket.on('message', onMessage);
      this.send(conn, {
        type: 'execute',
        invocationId: input.context.invocationId,
        tool: input.tool,
        args: input.args,
        context: input.context,
        token,
      });
    });
  }
}