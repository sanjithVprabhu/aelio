import { resolveGeminiApiKey } from '@aelio/embedder';
import { createLLMClient } from '@aelio/llm';
import { decryptSync, type EncryptedValue } from '@aelio/crypto';
import { LLMProvider, type LLMClient, type LLMConfig, type Tenant } from '@aelio/types';

export interface TenantLlmClients {
  resolve: LLMClient;
  synthesize: LLMClient;
}

function apiKeyFromConfig(config: LLMConfig, env: NodeJS.ProcessEnv): string | undefined {
  if (config.mode === 'byok') {
    try {
      return decryptSync(JSON.parse(config.encryptedApiKey) as EncryptedValue);
    } catch {
      return undefined;
    }
  }
  const provider = config.provider;
  if (provider === LLMProvider.OpenAI) return env.OPENAI_API_KEY;
  if (provider === LLMProvider.Anthropic) return env.ANTHROPIC_API_KEY;
  if (provider === LLMProvider.Google) return resolveGeminiApiKey(env);
  return undefined;
}

/** Per-tenant resolve + synthesize LLM clients (BYOK or platform). */
export function createTenantLlmClients(tenant: Tenant, env: NodeJS.ProcessEnv = process.env): TenantLlmClients {
  const base = tenant.llmConfig;
  const synthConfig: LLMConfig =
    (base as { synthesize?: LLMConfig }).synthesize ??
    ({ ...base, model: env.LLM_SYNTHESIZE_MODEL ?? base.model } as LLMConfig);
  return {
    resolve: createLLMClient({ config: base, apiKey: apiKeyFromConfig(base, env) }),
    synthesize: createLLMClient({ config: synthConfig, apiKey: apiKeyFromConfig(synthConfig, env) }),
  };
}
