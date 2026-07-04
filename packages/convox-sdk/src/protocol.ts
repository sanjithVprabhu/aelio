import type { ExecuteContext, FlowManifest, StateManifest, ToolManifest } from './types.js';

/** Convox wire protocol version implemented by this SDK. */
export const CONVOX_PROTOCOL_VERSION = '1.2.0';

/** Default WebSocket path (appended to the derived WS origin). */
export const CONVOX_STREAM_PATH = '/v1/convox/stream';

// ---- Client → Aelio ----

export type ClientMessage =
  | {
      type: 'register';
      instanceId: string;
      convoxVersion: string;
      tenantId: string;
      tools: ToolManifest[];
      states?: StateManifest[];
      flows?: FlowManifest[];
    }
  | { type: 'tool_upsert'; instanceId: string; tool: ToolManifest }
  | { type: 'tool_remove'; instanceId: string; key: string }
  | { type: 'state_upsert'; instanceId: string; state: StateManifest }
  | { type: 'state_remove'; instanceId: string; key: string }
  | { type: 'flow_upsert'; instanceId: string; flow: FlowManifest }
  | { type: 'flow_remove'; instanceId: string; stateKey: string; objectiveKey: string }
  | { type: 'heartbeat'; instanceId: string; ts: number }
  | { type: 'execute_result'; invocationId: string; data: unknown }
  | {
      type: 'execute_error';
      invocationId: string;
      error: { code: string; message: string };
    };

// ---- Aelio → Client ----

export type ServerMessage =
  | { type: 'registered'; connectionId: string }
  | { type: 'pong'; ts?: number }
  | { type: 'error'; code: string; message: string }
  | {
      type: 'execute';
      invocationId: string;
      tool: string;
      args: Record<string, unknown>;
      context: ExecuteContext;
      /** HMAC JWT over `context` — verified by the SDK before running the handler. */
      token?: string;
    }
  | {
      type: 'push_event';
      eventType: string;
      payload: Record<string, unknown>;
    };

export function convoxWebSocketUrl(aelioBaseUrl: string): string {
  const trimmed = aelioBaseUrl.trim().replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  return `${wsBase}${CONVOX_STREAM_PATH}`;
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeClientMessage(raw: string): ClientMessage {
  return parseMessage(raw) as ClientMessage;
}

export function decodeServerMessage(raw: string): ServerMessage {
  return parseMessage(raw) as ServerMessage;
}

function parseMessage(raw: string): ClientMessage | ServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProtocolError('invalid_json', 'Message is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    throw new ProtocolError('invalid_envelope', 'Message is missing a type field.');
  }
  return parsed as ClientMessage | ServerMessage;
}

export class ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}