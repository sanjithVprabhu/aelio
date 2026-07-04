import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { AppError } from '@aelio/errors';
import { initContainer, type Container } from './container.js';
import { registerApiRoutes } from './routes/api.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerInternalRoutes } from './routes/internal.js';
import { registerPageRoutes } from './routes/pages.js';
import { registerWsChat } from './routes/ws-chat.js';
import { registerConvoxRoutes } from './routes/convox.js';
import { resolveServerRuntimeConfig } from './runtime/server-config.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

export async function buildApp(container?: Container): Promise<{ app: FastifyInstance; container: Container }> {
  const c = container ?? (await initContainer());
  const runtime = resolveServerRuntimeConfig();
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });

  // Allow the admin app (and embedded widgets) to call the API from the browser.
  await app.register(fastifyCors, { origin: true, credentials: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send(err.toJSON());
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal error';
    reply.code(500).send({ code: 'INTERNAL_ERROR', message });
  });

  // WebSocket support (web-chat streaming).
  await app.register(fastifyWebsocket);
  await registerWsChat(app, c);

  // JSON API + admin surface + internal mesh + branded HTML pages.
  registerAuthRoutes(app, c);
  registerApiRoutes(app, c);
  registerAdminRoutes(app, c);
  registerInternalRoutes(app, c);
  registerPageRoutes(app, c, runtime);
  registerConvoxRoutes(app, c);

  // The three designed pages (self-contained standalone bundles).
  await app.register(fastifyStatic, { root: publicDir, prefix: '/', index: ['index.html'] });
  app.get('/onboarding', (_req, reply) => reply.sendFile('onboarding.html'));
  app.get('/app', (_req, reply) => reply.sendFile('app.html'));

  return { app, container: c };
}
