import { createLogger } from '@aelio/logger';
import { buildApp } from './app.js';

const log = createLogger({});

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const { app, container } = await buildApp();
  await app.listen({ port, host: '0.0.0.0' });

  const base = container.baseUrl;
  log.info({ port }, 'aelio api listening');
  // eslint-disable-next-line no-console
  console.log(`
  Aelio is running.

    Landing page      ${base}/
    Onboarding        ${base}/onboarding
    Dashboard         ${base}/app
    Live chat demo    ${base}/chat
    Health            ${base}/healthz

  Demo tenant: "${container.store.getTenantBySlug(container.demoTenantSlug)?.name}" (slug: ${container.demoTenantSlug})
  LLM provider: ${process.env.LLM_PROVIDER ?? 'scripted'} (set ANTHROPIC_API_KEY + LLM_PROVIDER=anthropic for the real model)
`);
}

main().catch((err) => {
  log.error({ err }, 'failed to start');
  process.exit(1);
});
