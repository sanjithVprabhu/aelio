import { ConvoxConnection } from './connection.js';
import { FlowRegistry } from './flow-registry.js';
import { CONVOX_PROTOCOL_VERSION } from './protocol.js';
import { ToolRegistry } from './registry.js';
import { StateRegistry } from './state-registry.js';
import { defaultInstanceId, signIdentity, verifyExecuteToken } from './token.js';
import { postConvoxWebhook } from './webhook.js';
import type {
  ConvoxConfig,
  ConvoxEventMap,
  ExecuteContext,
  FlowManifest,
  IdentityAssertion,
  StateManifest,
  ToolDefinition,
  ToolManifest,
  ToolPolicy,
} from './types.js';

type EventHandler<K extends keyof ConvoxEventMap> = (payload: ConvoxEventMap[K]) => void;

/**
 * Customer-side Convox SDK — register tools in code and serve execute requests
 * from the Aelio server over a persistent outbound WebSocket.
 */
export class AelioConvox {
  private readonly registry = new ToolRegistry();
  private readonly states = new StateRegistry();
  private readonly flows = new FlowRegistry();
  private readonly config: Required<
    Pick<
      ConvoxConfig,
      | 'tenantId'
      | 'apiKey'
      | 'aelioBaseUrl'
      | 'instanceId'
      | 'convoxVersion'
      | 'heartbeatIntervalMs'
      | 'executeTimeoutMs'
      | 'registerTimeoutMs'
      | 'reconnect'
      | 'reconnectMinDelayMs'
      | 'reconnectMaxDelayMs'
    >
  >;
  private readonly listeners = new Map<keyof ConvoxEventMap, Set<EventHandler<keyof ConvoxEventMap>>>();
  private readonly webhookUrl?: string;
  private connection: ConvoxConnection | null = null;
  private connectionId: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private resyncHandler: (() => void) | null = null;
  private registrationWait:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | null = null;

  constructor(config: ConvoxConfig) {
    if (!config?.tenantId || !config?.apiKey || !config?.aelioBaseUrl) {
      throw new Error('[convox] AelioConvox requires { tenantId, apiKey, aelioBaseUrl }');
    }
    this.config = {
      tenantId: config.tenantId,
      apiKey: config.apiKey,
      aelioBaseUrl: config.aelioBaseUrl,
      instanceId: config.instanceId ?? defaultInstanceId(),
      convoxVersion: config.convoxVersion ?? CONVOX_PROTOCOL_VERSION,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 20_000,
      executeTimeoutMs: config.executeTimeoutMs ?? 10_000,
      registerTimeoutMs: config.registerTimeoutMs ?? 10_000,
      reconnect: config.reconnect ?? true,
      reconnectMinDelayMs: config.reconnectMinDelayMs ?? 1_000,
      reconnectMaxDelayMs: config.reconnectMaxDelayMs ?? 30_000,
    };
    this.webhookUrl = config.webhookUrl;
  }

  get isConnected(): boolean {
    return this.connection?.connected ?? false;
  }

  get isReady(): boolean {
    return this.connectionId !== null && this.isConnected;
  }

  get instanceId(): string {
    return this.config.instanceId;
  }

  /** Register or replace a tool. Pushes `tool_upsert` when already connected. */
  tool<TArgs = Record<string, unknown>, TResult = unknown>(
    key: string,
    definition: ToolDefinition<TArgs, TResult>,
  ): this {
    this.registry.set(key, definition);
    this.emit('tool:registered', { key });
    if (definition.policy) {
      this.emit('policy:updated', { key });
    }
    if (this.isConnected) {
      this.sendUpsert(key);
    }
    return this;
  }

  /** Update policy overrides for an existing tool. */
  policy(key: string, policy: ToolPolicy): this {
    const existing = this.registry.listManifests().find((t) => t.key === key);
    if (!existing) {
      throw new Error(`[convox] Cannot set policy — no tool registered for '${key}'.`);
    }
    this.registry.set(key, {
      description: existing.description,
      inputSchema: existing.inputSchema,
      version: existing.version,
      policy,
      handler: this.registry.getHandler(key)!,
    });
    this.emit('policy:updated', { key });
    if (this.isConnected) {
      this.sendUpsert(key);
    }
    return this;
  }

  /**
   * Register a conversation phase. Aelio infers the active state from chat and
   * guides the user toward {@link StateManifest.objectives}. Tools are optional.
   */
  state(key: string, manifest: Omit<StateManifest, 'key'>): this {
    this.states.set(key, { ...manifest, key });
    this.emit('state:registered', { key });
    if (this.isConnected) {
      this.sendStateUpsert(key);
    }
    return this;
  }

  /** Remove a state definition locally and notify Aelio when connected. */
  removeState(key: string): this {
    const removed = this.states.delete(key);
    if (removed) {
      this.emit('state:removed', { key });
      if (this.isConnected) {
        this.send({
          type: 'state_remove',
          instanceId: this.config.instanceId,
          key,
        });
      }
    }
    return this;
  }

  /** Current state catalog held by this SDK instance. */
  listStates(): StateManifest[] {
    return this.states.listManifests();
  }

  /** Remove a tool locally and notify Aelio when connected. */
  removeTool(key: string): this {
    const removed = this.registry.delete(key);
    if (removed) {
      this.emit('tool:removed', { key });
      if (this.isConnected) {
        this.send({
          type: 'tool_remove',
          instanceId: this.config.instanceId,
          key,
        });
      }
    }
    return this;
  }

  /** Current tool catalog held by this SDK instance. */
  listTools(): ToolManifest[] {
    return this.registry.listManifests();
  }

  /**
   * Register an objective playbook. Aelio enforces step order in the harness PLAN phase.
   * Pushes `flow_upsert` when already connected.
   */
  flow(manifest: FlowManifest): this {
    this.flows.set(manifest);
    this.emit('flow:registered', {
      stateKey: manifest.stateKey,
      objectiveKey: manifest.objectiveKey,
    });
    if (this.isConnected) {
      this.sendFlowUpsert(manifest.stateKey, manifest.objectiveKey);
    }
    return this;
  }

  /** Remove a flow locally and notify Aelio when connected. */
  removeFlow(stateKey: string, objectiveKey: string): this {
    const removed = this.flows.delete(stateKey, objectiveKey);
    if (removed) {
      this.emit('flow:removed', { stateKey, objectiveKey });
      if (this.isConnected) {
        this.send({
          type: 'flow_remove',
          instanceId: this.config.instanceId,
          stateKey,
          objectiveKey,
        });
      }
    }
    return this;
  }

  /** Current flow catalog held by this SDK instance. */
  listFlows(): FlowManifest[] {
    return this.flows.listManifests();
  }

  /**
   * Open the outbound WebSocket to Aelio and register all tools.
   * Safe to call multiple times — subsequent calls await the in-flight connect.
   */
  async connect(): Promise<void> {
    if (this.isReady) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  /** Close the WebSocket and stop heartbeats / reconnect loops. */
  async disconnect(): Promise<void> {
    this.connectPromise = null;
    this.connectionId = null;
    this.rejectRegistrationWait(new Error('[convox] Disconnected before registration completed.'));
    const conn = this.connection;
    this.connection = null;
    if (conn) await conn.disconnect();
  }

  /**
   * Sign an identity assertion so Aelio can bind a widget `sessionId` to your user.
   * Call from your backend when the user is already authenticated on your site.
   */
  signIdentity(assertion: IdentityAssertion, expiresInSeconds = 300): string {
    return signIdentity(this.config.tenantId, this.config.apiKey, assertion, expiresInSeconds);
  }

  on<K extends keyof ConvoxEventMap>(event: K, handler: EventHandler<K>): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<keyof ConvoxEventMap>);
    return this;
  }

  off<K extends keyof ConvoxEventMap>(event: K, handler: EventHandler<K>): this {
    this.listeners.get(event)?.delete(handler as EventHandler<keyof ConvoxEventMap>);
    return this;
  }

  /** Re-push the full catalog (used after reconnect). */
  syncTools(): void {
    if (!this.isConnected) {
      throw new Error('[convox] Cannot sync tools — not connected.');
    }
    this.sendRegister();
  }

  /** Re-push tools + states after reconnect. */
  syncStates(): void {
    if (!this.isConnected) {
      throw new Error('[convox] Cannot sync states — not connected.');
    }
    this.sendRegister();
  }

  /** Re-push tools + states + flows after reconnect. */
  syncFlows(): void {
    if (!this.isConnected) {
      throw new Error('[convox] Cannot sync flows — not connected.');
    }
    this.sendRegister();
  }

  /** @internal Test hook: run when the transport opens (including reconnect). */
  setResyncHandler(handler: (() => void) | null): void {
    this.resyncHandler = handler;
  }

  private async doConnect(): Promise<void> {
    const conn = new ConvoxConnection({
      tenantId: this.config.tenantId,
      apiKey: this.config.apiKey,
      aelioBaseUrl: this.config.aelioBaseUrl,
      instanceId: this.config.instanceId,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      reconnect: this.config.reconnect,
      reconnectMinDelayMs: this.config.reconnectMinDelayMs,
      reconnectMaxDelayMs: this.config.reconnectMaxDelayMs,
    });

    conn.setMessageHandler((message) => {
      void this.handleServerMessage(message);
    });

    conn.setOpenHandler(() => {
      this.sendRegister();
      this.resyncHandler?.();
    });

    conn.setCloseHandler((code, reason) => {
      this.connectionId = null;
      this.rejectRegistrationWait(
        new Error(`[convox] Connection closed before registration completed (${code}): ${reason}`),
      );
      this.emit('disconnected', { code, reason });
    });

    conn.setErrorHandler((error) => {
      this.emit('error', error);
    });

    this.connection = conn;
    await conn.connect();
    await this.waitForRegistration();
  }

  private sendRegister(): void {
    this.send({
      type: 'register',
      instanceId: this.config.instanceId,
      convoxVersion: this.config.convoxVersion,
      tenantId: this.config.tenantId,
      tools: this.registry.listManifests(),
      states: this.states.listManifests(),
      flows: this.flows.listManifests(),
    });
  }

  private sendStateUpsert(key: string): void {
    const manifest = this.states.get(key);
    if (!manifest) return;
    this.send({
      type: 'state_upsert',
      instanceId: this.config.instanceId,
      state: manifest,
    });
  }

  private sendUpsert(key: string): void {
    const manifest = this.registry.listManifests().find((t) => t.key === key);
    if (!manifest) return;
    this.send({
      type: 'tool_upsert',
      instanceId: this.config.instanceId,
      tool: manifest,
    });
  }

  private sendFlowUpsert(stateKey: string, objectiveKey: string): void {
    const manifest = this.flows.get(stateKey, objectiveKey);
    if (!manifest) return;
    this.send({
      type: 'flow_upsert',
      instanceId: this.config.instanceId,
      flow: manifest,
    });
  }

  private send(message: Parameters<ConvoxConnection['send']>[0]): void {
    this.connection?.send(message);
  }

  private async handleServerMessage(message: import('./protocol.js').ServerMessage): Promise<void> {
    switch (message.type) {
      case 'registered':
        this.connectionId = message.connectionId;
        this.resolveRegistrationWait();
        this.emit('connected', { connectionId: message.connectionId });
        break;
      case 'pong':
        break;
      case 'error':
        this.emit('error', new Error(`[convox] ${message.code}: ${message.message}`));
        break;
      case 'execute':
        await this.handleExecute(message);
        break;
      case 'push_event':
        this.emit('push', { eventType: message.eventType, payload: message.payload });
        if (this.webhookUrl) {
          postConvoxWebhook(this.webhookUrl, {
            eventType: message.eventType,
            payload: message.payload,
          });
        }
        break;
      default:
        break;
    }
  }

  private async handleExecute(message: Extract<import('./protocol.js').ServerMessage, { type: 'execute' }>): Promise<void> {
    const { invocationId, tool, args, context, token } = message;
    this.emit('execute', { tool, invocationId });

    const handler = this.registry.getHandler(tool);
    if (!handler) {
      this.send({
        type: 'execute_error',
        invocationId,
        error: { code: 'tool_not_found', message: `No handler registered for '${tool}'.` },
      });
      return;
    }

    let trustedContext: ExecuteContext = context;
    try {
      if (!token) {
        throw new Error('Missing execute token.');
      }
      trustedContext = verifyExecuteToken(token, this.config.apiKey, {
        invocationId,
        tenantId: this.config.tenantId,
        tool,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Execute token verification failed.';
      this.send({
        type: 'execute_error',
        invocationId,
        error: { code: 'unauthorized', message: msg },
      });
      return;
    }

    try {
      const data = await this.runWithTimeout(
        Promise.resolve(handler(trustedContext, args)),
        this.config.executeTimeoutMs,
      );
      this.send({ type: 'execute_result', invocationId, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Handler threw an unknown error.';
      this.send({
        type: 'execute_error',
        invocationId,
        error: { code: 'handler_error', message: msg },
      });
    }
  }

  private runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Handler timed out after ${ms}ms.`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private waitForRegistration(): Promise<void> {
    if (this.connectionId) return Promise.resolve();
    if (this.registrationWait) {
      return new Promise<void>((resolve, reject) => {
        const current = this.registrationWait;
        if (!current) {
          resolve();
          return;
        }
        const originalResolve = current.resolve;
        const originalReject = current.reject;
        current.resolve = () => {
          originalResolve();
          resolve();
        };
        current.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.registrationWait = null;
        reject(
          new Error(
            `[convox] Timed out waiting for registration ack after ${this.config.registerTimeoutMs}ms.`,
          ),
        );
      }, this.config.registerTimeoutMs);
      this.registrationWait = { resolve, reject, timer };
    });
  }

  private resolveRegistrationWait(): void {
    if (!this.registrationWait) return;
    clearTimeout(this.registrationWait.timer);
    const { resolve } = this.registrationWait;
    this.registrationWait = null;
    resolve();
  }

  private rejectRegistrationWait(error: Error): void {
    if (!this.registrationWait) return;
    clearTimeout(this.registrationWait.timer);
    const { reject } = this.registrationWait;
    this.registrationWait = null;
    reject(error);
  }

  private emit<K extends keyof ConvoxEventMap>(event: K, payload: ConvoxEventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      (handler as EventHandler<K>)(payload);
    }
  }
}
