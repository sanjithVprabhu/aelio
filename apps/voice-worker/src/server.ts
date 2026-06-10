import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { createLogger } from '@aelio/logger';
import { ChannelType } from '@aelio/types';
import {
  generateOtp,
  selectVoiceProviders,
  twimlGather,
  twimlHangup,
  twimlSayAndGather,
} from './voice.js';

/**
 * apps/voice-worker — real-time voice handler (manual §4 / §11). Twilio posts
 * call webhooks; we return TwiML. Speech results (Deepgram in prod, mock here)
 * become transcripts that go to the api's `/internal/ingest`; replies are spoken
 * back via TTS (ElevenLabs in prod). A media-stream WebSocket mirrors the same
 * loop. Voice OTP verifies the caller by SMS/DTMF.
 */

const PORT = Number(process.env.PORT ?? 3200);
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? 's'.repeat(48);

const log = createLogger({ channelType: 'voice-worker' });
// Real Deepgram/ElevenLabs when API keys are present, else mocks.
const { stt, tts } = selectVoiceProviders();

interface OtpRecord {
  code: string;
  attempts: number;
  expiresAt: number;
}
const otps = new Map<string, OtpRecord>();

interface IngestResponse {
  replies?: Array<{ kind: string; text: string; url?: string }>;
}

async function ingest(slug: string, from: string, text: string, callSid?: string): Promise<IngestResponse> {
  const res = await fetch(`${API_BASE_URL}/internal/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify({
      tenantSlug: slug,
      channelType: ChannelType.Voice,
      identifier: from,
      text,
      externalId: callSid ? `${callSid}_${Date.now()}` : undefined,
    }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}`);
  return (await res.json()) as IngestResponse;
}

function replyText(r: IngestResponse): string {
  return (r.replies ?? []).map((x) => x.text).join(' ') || 'One moment.';
}

const app = Fastify({ logger: false });
await app.register(websocket);
// Twilio posts application/x-www-form-urlencoded.
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(body as string)));
});

app.get('/healthz', async () => ({ status: 'ok', worker: 'voice-worker' }));

// Inbound call → greet + gather speech.
app.post<{ Params: { slug: string }; Body: { From?: string; CallSid?: string } }>(
  '/webhooks/voice/:slug',
  async (req, reply) => {
    reply.type('text/xml');
    log.info({ from: req.body.From, callSid: req.body.CallSid }, 'inbound call');
    return twimlGather(req.params.slug, "You've reached Acme Analytics. How can I help?");
  },
);

// Speech result → STT → ingest → TTS → next TwiML.
app.post<{ Params: { slug: string }; Body: { SpeechResult?: string; Digits?: string; From?: string; CallSid?: string } }>(
  '/voice/handle/:slug',
  async (req, reply) => {
    reply.type('text/xml');
    const transcript = await stt.transcribe(req.body.SpeechResult ?? req.body.Digits ?? '');
    if (!transcript || /good ?bye|hang up|that's all/i.test(transcript)) {
      return twimlHangup('Thanks for calling. Goodbye.');
    }
    const result = await ingest(req.params.slug, req.body.From ?? 'unknown', transcript, req.body.CallSid);
    const spoken = await tts.synthesize(replyText(result));
    return twimlSayAndGather(req.params.slug, spoken, 'Anything else?');
  },
);

// Voice OTP — SMS/DTMF step. Start sets a code; verify checks it (max 3 attempts).
app.post<{ Params: { slug: string }; Body: { From: string } }>('/voice/otp/:slug/start', async (req) => {
  const code = generateOtp();
  otps.set(req.body.From, { code, attempts: 0, expiresAt: Date.now() + 5 * 60 * 1000 });
  log.info({ from: req.body.From }, 'otp issued (would SMS in prod)');
  // In prod the code is sent via SMS, never returned. Returned here for the demo only.
  return { sent: true, devCode: code };
});

app.post<{ Params: { slug: string }; Body: { From: string; code: string } }>(
  '/voice/otp/:slug/verify',
  async (req, reply) => {
    const rec = otps.get(req.body.From);
    if (!rec || Date.now() > rec.expiresAt) {
      reply.code(400);
      return { verified: false, reason: 'expired' };
    }
    rec.attempts++;
    if (rec.attempts > 3) {
      otps.delete(req.body.From);
      reply.code(429);
      return { verified: false, reason: 'too_many_attempts' };
    }
    if (rec.code === req.body.code) {
      otps.delete(req.body.From);
      return { verified: true };
    }
    return { verified: false, reason: 'mismatch', attemptsLeft: 3 - rec.attempts };
  },
);

// Media-stream WebSocket (Twilio-style). Accepts:
//   {event:'transcript', text}      — pre-transcribed (testing / Twilio SpeechResult)
//   {event:'media', audio:<base64>} — raw audio → STT (Deepgram when configured)
// Responds with {event:'speak', text} and, when ElevenLabs is configured,
// {event:'audio', data:<base64>} for true synthesized speech.
app.register(async (instance) => {
  instance.get<{ Params: { sessionId: string } }>('/voice/stream/:sessionId', { websocket: true }, (socket, req) => {
    const slug = (req.query as { slug?: string }).slug ?? 'acme';
    const from = (req.query as { from?: string }).from ?? `call_${req.params.sessionId}`;
    socket.on('message', async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { event: string; text?: string; audio?: string };
        let transcript: string | undefined;
        if (msg.event === 'transcript' && msg.text) transcript = await stt.transcribe(msg.text);
        else if (msg.event === 'media' && msg.audio) transcript = await stt.transcribe(msg.audio);

        if (transcript) {
          const result = await ingest(slug, from, transcript, req.params.sessionId);
          const text = replyText(result);
          socket.send(JSON.stringify({ event: 'speak', text: await tts.synthesize(text) }));
          // Real audio when a TTS provider supports it (ElevenLabs).
          const synthAudio = (tts as { synthesizeAudio?: (t: string) => Promise<Buffer> }).synthesizeAudio;
          if (synthAudio) {
            const audio = await synthAudio(text);
            socket.send(JSON.stringify({ event: 'audio', data: audio.toString('base64') }));
          }
        }
      } catch (err) {
        socket.send(JSON.stringify({ event: 'error', message: err instanceof Error ? err.message : 'bad frame' }));
      }
    });
    socket.send(JSON.stringify({ event: 'ready', sessionId: req.params.sessionId }));
  });
});

async function main(): Promise<void> {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info({ port: PORT, api: API_BASE_URL }, 'voice-worker listening');
  // eslint-disable-next-line no-console
  console.log(`voice-worker on :${PORT} → api ${API_BASE_URL}
  POST /webhooks/voice/:slug (TwiML) · /voice/handle/:slug · /voice/otp/:slug/{start,verify}
  WS   /voice/stream/:sessionId`);
}

main().catch((err) => {
  log.error({ err }, 'voice-worker failed');
  process.exit(1);
});

export { app };
