/**
 * Structured logger with tenant/trace context. Dependency-free (emits JSON to
 * stdout) so it runs anywhere; in production this is swapped for Pino → Fluent
 * Bit → Datadog. Every log line carries the bound context fields.
 */
export interface LogContext {
  tenantId?: string;
  conversationId?: string;
  endUserId?: string;
  identityId?: string;
  traceId?: string;
  spanId?: string;
  channelType?: string;
  playbookId?: string;
  component?: string;
  engine?: string;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(obj: Record<string, unknown> | string, msg?: string): void;
  info(obj: Record<string, unknown> | string, msg?: string): void;
  warn(obj: Record<string, unknown> | string, msg?: string): void;
  error(obj: Record<string, unknown> | string, msg?: string): void;
  child(ctx: LogContext): Logger;
}

function emit(level: Level, context: LogContext, objOrMsg: Record<string, unknown> | string, msg?: string): void {
  const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const base: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    ...context,
  };
  if (typeof objOrMsg === 'string') base.msg = objOrMsg;
  else {
    Object.assign(base, objOrMsg);
    if (msg) base.msg = msg;
  }
  // Serialize Error objects readably.
  if (base.err instanceof Error) {
    base.err = { name: base.err.name, message: base.err.message, stack: base.err.stack };
  }
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(base) + '\n');
}

export function createLogger(context: LogContext = {}): Logger {
  return {
    debug: (o, m) => emit('debug', context, o, m),
    info: (o, m) => emit('info', context, o, m),
    warn: (o, m) => emit('warn', context, o, m),
    error: (o, m) => emit('error', context, o, m),
    child: (ctx) => createLogger({ ...context, ...ctx }),
  };
}

export const rootLogger = createLogger();
