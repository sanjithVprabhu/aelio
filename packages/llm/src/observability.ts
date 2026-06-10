import {
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamChunk,
} from '@aelio/types';

/**
 * LLM observability. Every model call flows through `packages/llm`, so this is
 * the single integration point for tracing (Langfuse in the manual). The
 * decorator wraps any LLMClient and posts a trace per call when Langfuse
 * credentials are configured; otherwise it's a transparent pass-through.
 */
export interface LlmTraceEvent {
  provider: string;
  model: string;
  tenantId: string;
  conversationId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

export type LlmObserver = (e: LlmTraceEvent) => void;

class ObservingClient implements LLMClient {
  constructor(
    private readonly inner: LLMClient,
    private readonly observer: LlmObserver,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const res = await this.inner.complete(request);
    this.observer({
      provider: String(res.provider),
      model: res.model,
      tenantId: request.tenantId,
      conversationId: request.conversationId,
      latencyMs: res.latencyMs,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      toolCalls: res.toolCalls?.length ?? 0,
    });
    return res;
  }

  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    return this.inner.stream(request);
  }
}

/** Wrap a client so each completion is traced. */
export function withObservability(client: LLMClient, observer: LlmObserver): LLMClient {
  return new ObservingClient(client, observer);
}

/** A Langfuse-backed observer (ingestion REST API). No SDK dependency. */
export function langfuseObserver(opts: {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}): LlmObserver {
  const base = opts.baseUrl ?? 'https://cloud.langfuse.com';
  const auth = Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString('base64');
  return (e) => {
    void fetch(`${base}/api/public/ingestion`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        batch: [
          {
            type: 'generation-create',
            id: `${e.conversationId}-${Date.now()}`,
            timestamp: new Date().toISOString(),
            body: {
              name: 'agent-turn',
              model: e.model,
              metadata: { provider: e.provider, tenantId: e.tenantId, toolCalls: e.toolCalls },
              usage: { input: e.inputTokens, output: e.outputTokens },
              latency: e.latencyMs,
            },
          },
        ],
      }),
    }).catch(() => {
      /* observability must never break the request path */
    });
  };
}

/** Build an observer from env (Langfuse) if configured, else undefined. */
export function observerFromEnv(): LlmObserver | undefined {
  const pub = process.env.LANGFUSE_PUBLIC_KEY;
  const sec = process.env.LANGFUSE_SECRET_KEY;
  if (pub && sec) return langfuseObserver({ publicKey: pub, secretKey: sec, baseUrl: process.env.LANGFUSE_BASE_URL });
  return undefined;
}
