import { describe, it, expect } from 'vitest';
import { LLMProvider } from '@aelio/types';
import {
  defaultLlmModel,
  platformLlmConfig,
  resolvePlatformApiKey,
  resolvePlatformLlmProvider,
} from './platform-llm.js';

describe('platformLlmConfig', () => {
  it('defaults to Google when GEMINI_API_KEY is set', () => {
    const env = { GEMINI_API_KEY: 'gk_test' } as NodeJS.ProcessEnv;
    expect(resolvePlatformLlmProvider(env)).toBe(LLMProvider.Google);
    expect(defaultLlmModel(LLMProvider.Google, env)).toBe('gemini-2.5-flash');
    expect(resolvePlatformApiKey(LLMProvider.Google, env)).toBe('gk_test');
    expect(platformLlmConfig(env)).toEqual({
      mode: 'platform',
      provider: LLMProvider.Google,
      model: 'gemini-2.5-flash',
    });
  });

  it('prefers explicit LLM_PROVIDER over auto-detect', () => {
    const env = {
      GEMINI_API_KEY: 'gk_test',
      LLM_PROVIDER: 'scripted',
    } as NodeJS.ProcessEnv;
    expect(resolvePlatformLlmProvider(env)).toBe(LLMProvider.Scripted);
  });

  it('accepts legacy GOOGLE_AI_API_KEY', () => {
    const env = { GOOGLE_AI_API_KEY: 'legacy_key' } as NodeJS.ProcessEnv;
    expect(resolvePlatformLlmProvider(env)).toBe(LLMProvider.Google);
    expect(resolvePlatformApiKey(LLMProvider.Google, env)).toBe('legacy_key');
  });
});