import WebSocket from 'ws';
import {
  CONVOX_PROTOCOL_VERSION,
  convoxWebSocketUrl,
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';

export interface ConnectionOptions {
  tenantId: string;
  apiKey: string;
  aelioBaseUrl: string;
  instanceId: string;
  heartbeatIntervalMs: number;
  reconnect: boolean;
  reconnectMinDelayMs: number;
  reconnectMaxDelayMs: number;
}

type MessageHandler = (message: ServerMessage) => void;
type VoidHandler = () => void;
type ErrorHandler = (error: Error) => void;

export class ConvoxConnection {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private readonly pendingConnect: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  private onMessage: MessageHandler = () => undefined;
  private onOpen: VoidHandler = () => undefined;
  private onClose: ((code: number, reason: string) => void) | null = null;
  private onError: ErrorHandler = () => undefined;

  constructor(private readonly opts: ConnectionOptions) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  setMessageHandler(handler: MessageHandler): void {
    this.onMessage = handler;
  }

  setOpenHandler(handler: VoidHandler): void {
    this.onOpen = handler;
  }

  setCloseHandler(handler: (code: number, reason: string) => void): void {
    this.onClose = handler;
  }

  setErrorHandler(handler: ErrorHandler): void {
    this.onError = handler;
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.clearReconnectTimer();
    if (this.connected) return;

    const url = convoxWebSocketUrl(this.opts.aelioBaseUrl);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'X-Convox-Version': CONVOX_PROTOCOL_VERSION,
          'X-Convox-Instance-Id': this.opts.instanceId,
          'X-Convox-Tenant-Id': this.opts.tenantId,
        },
      });

      this.socket = ws;

      const fail = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        ws.removeListener('open', onOpen);
        ws.removeListener('error', onError);
        ws.removeListener('close', onCloseEarly);
      };

      const onOpen = () => {
        cleanup();
        this.reconnectAttempt = 0;
        this.attachSocketHandlers(ws);
        this.startHeartbeat();
        resolve();
      };

      const onError = (err: Error) => fail(err);

      const onCloseEarly = () => {
        fail(new Error('[convox] WebSocket closed before the connection was established.'));
      };

      ws.once('open', onOpen);
      ws.once('error', onError);
      ws.once('close', onCloseEarly);
    });
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    const ws = this.socket;
    this.socket = null;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }
      ws.once('close', () => resolve());
      ws.close(1000, 'convox_disconnect');
    });
  }

  send(message: ClientMessage): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('[convox] Cannot send — not connected to Aelio.');
    }
    ws.send(encodeMessage(message));
  }

  private attachSocketHandlers(ws: WebSocket): void {
    ws.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        this.onMessage(decodeServerMessage(text));
      } catch (err) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on('error', (err) => {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on('close', (code, reasonBuf) => {
      this.stopHeartbeat();
      this.socket = null;
      const reason = reasonBuf.toString('utf8') || 'connection_closed';
      this.onClose?.(code, reason);
      if (!this.intentionalClose && this.opts.reconnect) {
        this.scheduleReconnect();
      }
    });

    this.onOpen();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      try {
        this.send({
          type: 'heartbeat',
          instanceId: this.opts.instanceId,
          ts: Date.now(),
        });
      } catch {
        /* socket likely closed; close handler will reconnect */
      }
    }, this.opts.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalClose) return;
    const exp = Math.min(
      this.opts.reconnectMaxDelayMs,
      this.opts.reconnectMinDelayMs * 2 ** this.reconnectAttempt,
    );
    const jitter = Math.floor(Math.random() * 250);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) => this.onError(err));
    }, exp + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}