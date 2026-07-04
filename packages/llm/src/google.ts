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
 * Real Google Gemini provider over the generateContent API. Function calls map
 * to the internal LLMToolCall shape; tool results are sent back as
 * functionResponse parts.
 */
function url(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function toContents(messages: LLMMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const results = Array.isArray(m.content) ? m.content : [];
      out.push({
        role: 'user',
        parts: results.map((r) => ({
          functionResponse: { name: r.toolCallId, response: { result: r.content } },
        })),
      });
      continue;
    }
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content as string }] });
  }
  return out;
}

export class GoogleClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    const body: Record<string, unknown> = { contents: toContents(request.messages) };
    if (request.systemPrompt) body.systemInstruction = { parts: [{ text: request.systemPrompt }] };
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
      body.toolConfig = {
        functionCallingConfig: { mode: 'AUTO' },
      };
    }

    let res: Response;
    try {
      res = await fetch(url(this.model, this.apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw Errors.llmProviderError(`Google request failed: ${err instanceof Error ? err.message : 'network'}`);
    }
    if (!res.ok) throw Errors.llmProviderError(`Google ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const data = (await res.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    let content = '';
    const toolCalls: LLMToolCall[] = [];
    for (const p of parts) {
      if (p.text) content += p.text;
      if (p.functionCall) toolCalls.push({ id: p.functionCall.name, name: p.functionCall.name, args: p.functionCall.args });
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      model: this.model,
      provider: LLMProvider.Google,
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
