/** Google Gemini / Generative Language API key (GEMINI_API_KEY preferred). */
export function resolveGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_AI_API_KEY;
  return key?.trim() || undefined;
}