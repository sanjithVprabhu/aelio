/**
 * Demo customer backend — Convox Mode B with Postgres-persistent mock SaaS APIs.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AelioConvox } from '@aelio/convox-sdk';
import { DemoSaasStore, externalUserIdFromSession, registerDemoSaasCatalog } from '@aelio/demo-saas';

const baseUrl = process.env.AELIO_BASE_URL ?? 'http://localhost:3100';
const apiKey = process.env.AELIO_API_KEY ?? 'test_api_key';
const tenantId = process.env.AELIO_TENANT_SLUG ?? 'acme';
const webhookUrl = process.env.CONVOX_WEBHOOK_URL;
const customerBackendPort = Number(process.env.ACME_CONVOX_PORT ?? 3101);
const allowedOrigin = process.env.ACME_CONVOX_ALLOWED_ORIGIN ?? '*';

const store = new DemoSaasStore();
let convoxReady = false;

const convox = new AelioConvox({
  tenantId,
  apiKey,
  aelioBaseUrl: baseUrl,
  webhookUrl,
});

registerDemoSaasCatalog(convox, store);

function writeJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function demoIdentityForSession(sessionId: string): {
  userId: string;
  email: string;
  metadata: Record<string, unknown>;
} {
  const externalUserId = externalUserIdFromSession(sessionId);
  return {
    userId: externalUserId,
    email: 'owner@acme.test',
    metadata: {
      name: 'Taylor from Acme',
      role: 'workspace_owner',
      source: 'demo-customer-backend',
    },
  };
}

const customerBackend = createServer(async (req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${customerBackendPort}`}`);

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': allowedOrigin,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'cache-control': 'no-store',
    });
    res.end();
    return;
  }

  if (method === 'GET' && url.pathname === '/healthz') {
    writeJson(res, 200, {
      ok: true,
      service: 'demo-customer-backend',
      tenantId,
      connected: convoxReady,
      customerBackendUrl: `http://localhost:${customerBackendPort}`,
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/identity-token') {
    try {
      const body = await readJson(req);
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      if (!sessionId) {
        writeJson(res, 400, { ok: false, error: 'sessionId is required' });
        return;
      }
      const demoIdentity = demoIdentityForSession(sessionId);
      const userId =
        typeof body.userId === 'string' && body.userId.trim()
          ? body.userId.trim()
          : demoIdentity.userId;
      const email =
        typeof body.email === 'string' && body.email.trim()
          ? body.email.trim()
          : demoIdentity.email;
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim()
          : String(demoIdentity.metadata.name);

      const identityToken = convox.signIdentity({
        sessionId,
        userId,
        email,
        metadata: {
          ...demoIdentity.metadata,
          ...((body.metadata && typeof body.metadata === 'object') ? body.metadata : {}),
          name,
        },
      });

      writeJson(res, 200, {
        ok: true,
        identityToken,
        user: {
          sessionId,
          userId,
          email,
          name,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      writeJson(res, 500, { ok: false, error: message });
    }
    return;
  }

  writeJson(res, 404, { ok: false, error: 'not found' });
});

convox.on('connected', () => {
  convoxReady = true;
  // eslint-disable-next-line no-console
  console.log(`[demo-customer-backend] connected to Aelio at ${baseUrl} (tenant=${tenantId})`);
  // eslint-disable-next-line no-console
  console.log('[demo-customer-backend] Postgres-backed SaaS APIs ready (demo_saas_* tables)');
});

convox.on('push', ({ eventType, payload }) => {
  // eslint-disable-next-line no-console
  console.log(`[demo-customer-backend] push_event: ${eventType}`, payload);
});

convox.on('disconnected', ({ code, reason }) => {
  convoxReady = false;
  // eslint-disable-next-line no-console
  console.warn(`[demo-customer-backend] disconnected (${code}): ${reason}`);
});

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required — start Postgres and set DATABASE_URL in .env');
  }
  await store.connect();
  await new Promise<void>((resolve) => {
    customerBackend.listen(customerBackendPort, () => resolve());
  });
  // eslint-disable-next-line no-console
  console.log(`[demo-customer-backend] customer backend listening at http://localhost:${customerBackendPort}`);
  // eslint-disable-next-line no-console
  console.log(`[demo-customer-backend] dialing ${baseUrl} …`);
  await convox.connect();
}

main().catch((err) => {
  console.error('[demo-customer-backend] fatal', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  void store.close().finally(() => {
    customerBackend.close(() => process.exit(0));
  });
});
