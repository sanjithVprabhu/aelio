import { randomBytes } from 'node:crypto';
import { createLogger, type Logger } from '@aelio/logger';

/**
 * Minimal tracing primitives (W3C-style ids). The manual targets OpenTelemetry →
 * Datadog; this keeps the same shape (traceId/spanId, span timing) over the
 * structured logger so traces are correlatable without the OTel SDK wired in.
 */
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}
export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  log: Logger;
}

export function startTrace(fields: Record<string, string> = {}): SpanContext {
  const traceId = newTraceId();
  const spanId = newSpanId();
  return { traceId, spanId, log: createLogger({ traceId, spanId, ...fields }) };
}

/** Time a named span, emitting start/end with duration. */
export async function withSpan<T>(ctx: SpanContext, name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const spanId = newSpanId();
  const log = ctx.log.child({ spanId });
  try {
    const result = await fn();
    log.debug({ span: name, durationMs: Date.now() - start }, `span.${name}`);
    return result;
  } catch (err) {
    log.error({ span: name, durationMs: Date.now() - start, err }, `span.${name}.error`);
    throw err;
  }
}
