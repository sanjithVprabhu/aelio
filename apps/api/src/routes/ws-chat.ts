import type { FastifyInstance } from 'fastify';
import { ChannelType } from '@aelio/types';
import type { Container } from '../container.js';

/**
 * Web-chat over WebSocket (manual §4.5 web chat). The widget connects, sends
 * `{type:'message', text}`, and receives the bot reply streamed token-by-token:
 * `{type:'chunk', text}` … `{type:'done', state, actions}`. Verification and
 * step-up replies arrive as `{type:'link', kind, text, url}`.
 */
export async function registerWsChat(app: FastifyInstance, c: Container): Promise<void> {
  app.register(async (instance) => {
    instance.get<{ Params: { slug: string }; Querystring: { session?: string } }>(
      '/ws/chat/:slug',
      { websocket: true },
      (socket, req) => {
        const tenant = c.store.getTenantBySlug(req.params.slug);
        if (!tenant) {
          socket.send(JSON.stringify({ type: 'error', message: 'unknown tenant' }));
          socket.close();
          return;
        }
        const sessionId = req.query.session ?? `ws_${Math.random().toString(36).slice(2, 10)}`;
        socket.send(JSON.stringify({ type: 'ready', sessionId }));

        socket.on('message', async (raw: Buffer) => {
          let msg: { type?: string; text?: string };
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (msg.type !== 'message' || !msg.text) return;

          const result = await c.runtime.handleInbound({
            tenantId: tenant.id,
            channelType: ChannelType.WebChat,
            identifier: sessionId,
            text: msg.text,
          });

          for (const reply of result.replies) {
            if (reply.kind === 'text' || reply.kind === 'handoff') {
              // Stream the text token-by-token for a live typing feel.
              const words = reply.text.split(' ');
              for (const w of words) {
                socket.send(JSON.stringify({ type: 'chunk', text: w + ' ' }));
                await new Promise((r) => setTimeout(r, 15));
              }
              socket.send(JSON.stringify({ type: 'reply_end', kind: reply.kind }));
            } else {
              socket.send(JSON.stringify({ type: 'link', kind: reply.kind, text: reply.text, url: reply.url }));
            }
          }
          socket.send(
            JSON.stringify({
              type: 'done',
              state: result.state,
              actions: result.actions,
              needsVerification: result.needsVerification,
            }),
          );
        });
      },
    );
  });
}
