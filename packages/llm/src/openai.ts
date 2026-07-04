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
 * Real OpenAI provider over the Chat Completions API. Tool calls map to the
 * same internal LLMToolCall shape the agent loop consumes; tool results are
 * sent back as `role: "tool"` messages.
 */
const API_URL = 'https://api.openai.com/v1/chat/completions';

interface OAResponse {
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}

export function toOpenAIMessages(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const results = Array.isArray(m.content) ? m.content : [];
      for (const r of results) {
        out.push({
          role: 'tool',
          tool_call_id: r.toolCallId,
          content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
        });
      }
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: typeof m.content === 'string' && m.content.length > 0 ? m.content : null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export class OpenAIClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const messages = toOpenAIMessages(request.messages);
    if (request.systemPrompt) messages.unshift({ role: 'system', content: request.systemPrompt });
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw Errors.llmProviderError(`OpenAI request failed: ${err instanceof Error ? err.message : 'network'}`);
    }
    if (!res.ok) throw Errors.llmProviderError(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = (await res.json()) as OAResponse;
    const choice = data.choices[0]?.message;
    const toolCalls: LLMToolCall[] =
      choice?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeParse(tc.function.arguments),
      })) ?? [];

    return {
      content: choice?.content ?? '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model,
      provider: LLMProvider.OpenAI,
      latencyMs: Date.now() - started,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
    const res = await this.complete(request);
    if (res.content) yield { type: 'text_delta', text: res.content };
    for (const tc of res.toolCalls ?? []) {
      yield { type: 'tool_call_start', toolCall: tc };
      yield { type: 'tool_call_end', toolCall: tc };
    }
    yield { type: 'done', usage: { inputTokens: res.inputTokens, outputTokens: res.outputTokens } };
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
