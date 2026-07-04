export enum LLMProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  Google = 'google',
  /** Built-in deterministic provider for offline demos and tests. */
  Scripted = 'scripted',
}

export type LLMConfig =
  | { mode: 'platform'; provider: LLMProvider; model: string }
  | { mode: 'byok'; provider: LLMProvider; model: string; encryptedApiKey: string };

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  content: unknown;
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | LLMToolResult[];
  /** Required on assistant turns that invoked tools (OpenAI tool_calls replay). */
  toolCalls?: LLMToolCall[];
}

export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMTool[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tenantId: string;
  conversationId: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: LLMProvider;
  latencyMs: number;
  cost?: number;
}

export interface LLMStreamChunk {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  text?: string;
  toolCall?: Partial<LLMToolCall>;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
