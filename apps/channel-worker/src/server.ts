import Fastify from 'fastify';
import { createLogger } from '@aelio/logger';
import { ChannelType } from '@aelio/types';
import {
  selectProviders,
  verifyMetaSignature,
  verifySlackSignature,
  type OutboundReply,
} from './providers.js';

/**
 * apps/channel-worker — the dedicated channel adapter process (manual §4 / §11).
 * It verifies provider signatures, normalizes inbound payloads, hands them to
 * the api's `/internal/ingest`, and delivers the replies via outbound providers.
 * It holds NO conversation logic — it routes messages in and out.
 */

const PORT = Number(process.env.PORT ?? 3100);
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? 's'.repeat(48);
const META_APP_SECRET = process.env.META_APP_SECRET ?? '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';

const log = createLogger({ channelType: 'channel-worker' });
// Real providers when credentials are present (Meta/Twilio/Slack), else mocks.
const providers = selectProviders();

interface IngestResponse {
  replies?: OutboundReply[];
  deduplicated?: boolean;
}

async function ingest(body: {
  tenantSlug: string;
  channelType: ChannelType;
  identifier: string;
  text: string;
  externalId?: string;
}): Promise<IngestResponse> {
  const res = await fetch(`${API_BASE_URL}/internal/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ingest failed: ${res.status}`);
  return (await res.json()) as IngestResponse;
}

const app = Fastify({ logger: false });
// Capture the raw body for signature verification.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  try {
    (_req as { rawBody?: string }).rawBody = body as string;
    done(null, body ? JSON.parse(body as string) : {});
  } catch (err) {
    done(err as Error, undefined);
  }
});
// Twilio SMS posts application/x-www-form-urlencoded.
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
  (req as { rawBody?: string }).rawBody = body as string;
  done(null, Object.fromEntries(new URLSearchParams(body as string)));
});

app.get('/healthz', async () => ({ status: 'ok', worker: 'channel-worker' }));

// ---- WhatsApp ----
app.get<{ Params: { slug: string }; Querystring: Record<string, string> }>(
  '/webhooks/whatsapp/:slug',
  async (req, reply) => {
    // Meta verification handshake.
    const q = req.query;
    if (q['hub.mode'] === 'subscribe') {
      reply.code(200);
      return q['hub.challenge'];
    }
    return { ok: true };
  },
);

app.post<{ Params: { slug: string } }>('/webhooks/whatsapp/:slug', async (req, reply) => {
  const raw = (req as { rawBody?: string }).rawBody ?? '';
  if (!verifyMetaSignature(req.headers['x-hub-signature-256'] as string, raw, META_APP_SECRET)) {
    reply.code(403);
    return { error: 'bad signature' };
  }
  const body = req.body as {
    entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id: string; from: string; type: string; text?: { body: string } }> } }> }>;
  };
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type !== 'text' || !msg.text) continue;
        const result = await ingest({
          tenantSlug: req.params.slug,
          channelType: ChannelType.WhatsApp,
          identifier: msg.from,
          text: msg.text.body,
          externalId: msg.id,
        });
        if (result.replies?.length) await providers.whatsapp.deliver(msg.from, result.replies);
      }
    }
  }
  return { status: 200 }; // ack fast
});

// ---- SMS (Twilio form-ish, simplified to JSON) ----
app.post<{ Params: { slug: string }; Body: { From: string; Body: string; MessageSid?: string } }>(
  '/webhooks/sms/:slug',
  async (req) => {
    const { From, Body, MessageSid } = req.body;
    const result = await ingest({
      tenantSlug: req.params.slug,
      channelType: ChannelType.SMS,
      identifier: From,
      text: Body,
      externalId: MessageSid,
    });
    if (result.replies?.length) await providers.sms.deliver(From, result.replies);
    return { ok: true };
  },
);

// ---- Slack Events API ----
app.post<{ Params: { slug: string }; Body: Record<string, unknown> }>(
  '/webhooks/slack/:slug',
  async (req, reply) => {
    const raw = (req as { rawBody?: string }).rawBody ?? '';
    const body = req.body as { type?: string; challenge?: string; event?: { user?: string; text?: string; bot_id?: string; client_msg_id?: string } };
    if (body.type === 'url_verification') return { challenge: body.challenge };
    if (
      !verifySlackSignature(
        req.headers['x-slack-signature'] as string,
        req.headers['x-slack-request-timestamp'] as string,
        raw,
        SLACK_SIGNING_SECRET,
      )
    ) {
      reply.code(403);
      return { error: 'bad signature' };
    }
    const ev = body.event;
    if (ev && ev.text && ev.user && !ev.bot_id) {
      const result = await ingest({
        tenantSlug: req.params.slug,
        channelType: ChannelType.Slack,
        identifier: ev.user,
        text: ev.text,
        externalId: ev.client_msg_id,
      });
      if (result.replies?.length) await providers.slack.deliver(ev.user, result.replies);
    }
    return { ok: true };
  },
);

async function main(): Promise<void> {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info({ port: PORT, api: API_BASE_URL }, 'channel-worker listening');
  // eslint-disable-next-line no-console
  console.log(`channel-worker on :${PORT} → api ${API_BASE_URL}
  POST /webhooks/whatsapp/:slug · /webhooks/sms/:slug · /webhooks/slack/:slug`);
}

main().catch((err) => {
  log.error({ err }, 'channel-worker failed');
  process.exit(1);
});

export { app, ingest, providers };
