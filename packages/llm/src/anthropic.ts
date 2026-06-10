import { Errors } from '@aelio/errors';
import {
  LLMProvider,
  type LLMClient,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
  type LLMStreamChunk,
  type LLMToolCall,
} from '@aelio/types';

/**
 * Real Anthropic provider over the Messages API (POST /v1/messages). Uses fetch
 * directly to avoid an SDK dependency. Tool calls come back as `tool_use`
 * content blocks; tool results are sent back as `tool_result` blocks in a user
 * turn — exactly the shape the agent tool loop produces.
 *
 * Model IDs are the bare `claude-*` strings (e.g. claude-sonnet-4-6,
 * claude-opus-4-8). Default per tenant config; see @aelio/config LLM_MODEL.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

function toAnthropicMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // system handled separately
    if (m.role === 'tool') {
      // Tool results → a user turn of tool_result blocks.
      const results = Array.isArray(m.content) ? m.content : [];
      out.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.toolCallId,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export class AnthropicClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: toAnthropicMessages(request.messages),
    };
    if (request.systemPrompt) body.system = request.systemPrompt;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw Errors.llmProviderError(
        `Anthropic request failed: ${err instanceof Error ? err.message : 'network error'}`,
      );
    }

    if (!res.ok) {
      const text = await res.text();
      throw Errors.llmProviderError(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json()) as AnthropicResponse;
    const toolCalls: LLMToolCall[] = [];
    let content = '';
    for (const block of data.content) {
      if (block.type === 'text' && block.text) content += block.text;
      if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      model: data.model,
      provider: LLMProvider.Anthropic,
      latencyMs: Date.now() - started,
    };
  }

  // Non-streaming fallback wrapped as a single chunk. A production build would
  // use the SSE stream endpoint; the agent runtime treats this uniformly.
  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const res = await this.complete(request);
    if (res.content) yield { type: 'text_delta', text: res.content };
    for (const tc of res.toolCalls ?? []) {
      yield { type: 'tool_call_start', toolCall: tc };
      yield { type: 'tool_call_end', toolCall: tc };
    }
    yield {
      type: 'done',
      usage: { inputTokens: res.inputTokens, outputTokens: res.outputTokens },
    };
  }
}
