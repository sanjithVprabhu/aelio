import { Errors } from '@aelio/errors';
import type { ChannelType } from '@aelio/types';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import {
  alreadyProcessed,
  checkInboundRateLimit,
  isWithinBusinessHours,
  markInbound,
} from '../channel/guards.js';

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? 's'.repeat(48);

/**
 * Internal service-to-service ingress. The channel-worker and voice-worker
 * normalize provider payloads and POST here; this runs the agent runtime and
 * returns the replies for the worker to deliver. Authenticated with the shared
 * INTERNAL_SERVICE_SECRET (manual §3 service-to-service auth).
 */
export function registerInternalRoutes(app: FastifyInstance, c: Container): void {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return;
    const provided = req.headers['x-internal-secret'];
    if (provided !== INTERNAL_SECRET) {
      reply.code(401).send({ code: 'UNAUTHORIZED', message: 'invalid internal secret' });
    }
  });

  app.post<{
    Body: {
      tenantSlug: string;
      channelType: ChannelType;
      identifier: string;
      text: string;
      externalId?: string;
    };
  }>('/internal/ingest', async (req, reply) => {
    const { tenantSlug, channelType, identifier, text, externalId } = req.body;
    const tenant = c.store.getTenantBySlug(tenantSlug);
    if (!tenant) throw Errors.tenantNotFound(tenantSlug);

    // Dedup by provider message id.
    if (externalId && (await alreadyProcessed(c.kv, externalId))) {
      return { deduplicated: true, replies: [] };
    }

    const channel = c.store.findChannelByType(tenant.id, channelType);
    if (channel && !channel.inboundEnabled) {
      return { replies: [{ kind: 'text', text: channel.fallbackMessage }] };
    }
    if (channel && !isWithinBusinessHours(channel.businessHours)) {
      return { replies: [{ kind: 'text', text: channel.fallbackMessage }] };
    }

    // Sliding-window inbound rate limit.
    if (!(await checkInboundRateLimit(c.kv, tenant.id, identifier))) {
      reply.code(429);
      return { replies: [{ kind: 'text', text: 'You are sending messages too quickly — give me a moment.' }] };
    }

    await markInbound(c.kv, tenant.id, identifier);
    const result = await c.runtime.handleInbound({ tenantId: tenant.id, channelType, identifier, text });
    return result;
  });

  // Health for the internal mesh.
  app.get('/internal/health', async () => ({ ok: true }));
}
