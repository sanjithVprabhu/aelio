import { resolveGeminiApiKey } from '@aelio/embedder';
import { LLMProvider, type LLMConfig } from '@aelio/types';

export function resolvePlatformLlmProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  if (env.LLM_PROVIDER) return env.LLM_PROVIDER as LLMProvider;
  if (env.ANTHROPIC_API_KEY) return LLMProvider.Anthropic;
  if (env.OPENAI_API_KEY) return LLMProvider.OpenAI;
  if (resolveGeminiApiKey(env)) return LLMProvider.Google;
  return LLMProvider.Scripted;
}

export function defaultLlmModel(provider: LLMProvider, env: NodeJS.ProcessEnv = process.env): string {
  if (env.LLM_MODEL) return env.LLM_MODEL;
  switch (provider) {
    case LLMProvider.OpenAI:
      return 'gpt-4o';
    case LLMProvider.Anthropic:
      return 'claude-sonnet-4-6';
    case LLMProvider.Google:
      return 'gemini-2.5-flash';
    default:
      return 'scripted-router-v1';
  }
}

export function resolvePlatformApiKey(
  provider: LLMProvider,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (provider === LLMProvider.OpenAI) return env.OPENAI_API_KEY;
  if (provider === LLMProvider.Anthropic) return env.ANTHROPIC_API_KEY;
  if (provider === LLMProvider.Google) return resolveGeminiApiKey(env);
  return undefined;
}

/** Platform default LLM config — respects GEMINI_API_KEY for Google provider. */
export function platformLlmConfig(env: NodeJS.ProcessEnv = process.env): LLMConfig {
  const provider = resolvePlatformLlmProvider(env);
  return { mode: 'platform', provider, model: defaultLlmModel(provider, env) };
}