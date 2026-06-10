import { LLMProvider, type LLMClient, type LLMConfig } from '@aelio/types';
import { ScriptedClient } from './scripted.js';
import { AnthropicClient } from './anthropic.js';
import { OpenAIClient } from './openai.js';
import { GoogleClient } from './google.js';

export { ScriptedClient } from './scripted.js';
export { AnthropicClient } from './anthropic.js';
export { OpenAIClient } from './openai.js';
export { GoogleClient } from './google.js';
export * from './observability.js';
import { observerFromEnv, withObservability } from './observability.js';

export interface CreateClientOptions {
  /** Resolved tenant LLM config (or platform default). */
  config?: LLMConfig;
  /** Plaintext API key (already decrypted) for byok/platform. */
  apiKey?: string;
}

/**
 * Resolve an LLMClient. Falls back to the deterministic ScriptedClient whenever
 * the provider is `scripted` or no API key is available — so the platform runs
 * end-to-end with zero external credentials.
 */
export function createLLMClient(opts: CreateClientOptions = {}): LLMClient {
  const provider = opts.config?.provider ?? LLMProvider.Scripted;
  const model = opts.config?.model ?? 'scripted-router-v1';

  let client: LLMClient;
  if (provider === LLMProvider.Scripted || !opts.apiKey) {
    client = new ScriptedClient(model);
  } else {
    switch (provider) {
      case LLMProvider.Anthropic:
        client = new AnthropicClient(opts.apiKey, model);
        break;
      case LLMProvider.OpenAI:
        client = new OpenAIClient(opts.apiKey, model);
        break;
      case LLMProvider.Google:
        client = new GoogleClient(opts.apiKey, model);
        break;
      default:
        client = new ScriptedClient(model);
    }
  }

  // Trace every call through Langfuse when configured (manual §13.1).
  const observer = observerFromEnv();
  return observer ? withObservability(client, observer) : client;
}
