import { createLogger } from '@aelio/logger';
import { buildApp } from './app.js';
import { resolveServerRuntimeConfig } from './runtime/server-config.js';

const log = createLogger({});

async function main(): Promise<void> {
  const runtime = resolveServerRuntimeConfig();
  const { app, container } = await buildApp();
  await app.listen({ port: runtime.port, host: runtime.host });

  const base = container.baseUrl;
  log.info({ port: runtime.port, host: runtime.host }, 'aelio api listening');
  // eslint-disable-next-line no-console
  console.log(`
  Aelio is running.

    Landing page      ${base}/
    Onboarding        ${base}/onboarding
    Dashboard         ${base}/app
    Chat widget       ${base}${runtime.publicChatPath}
    Demo harness      ${base}${runtime.demoRoot}/chat
    Demo telemetry    ${base}${runtime.demoRoot}/telemetry
    Demo SaaS view    ${base}${runtime.demoRoot}/live
    Health            ${base}/healthz

  Demo tenant: "${container.store.getTenantBySlug(container.demoTenantSlug)?.name}" (slug: ${container.demoTenantSlug})
  Persistence: ${runtime.persistenceMode}
  Memory core: ${runtime.memoryMode}
  LLM provider: ${process.env.LLM_PROVIDER ?? (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY ? 'google' : 'scripted')}
  Embeddings: ${process.env.EMBEDDING_PROVIDER ?? (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY ? 'google' : 'hash')}
`);
}

main().catch((err) => {
  log.error({ err }, 'failed to start');
  process.exit(1);
});
