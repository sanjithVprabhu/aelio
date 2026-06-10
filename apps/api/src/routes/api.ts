import { maskSecret } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { normalizeWebChat } from '../channel/normalize.js';

/** All JSON API routes. Tenant is resolved by slug; every query is tenant-scoped. */
export function registerApiRoutes(app: FastifyInstance, c: Container): void {
  const tenantBySlug = (slug: string) => {
    const t = c.store.getTenantBySlug(slug);
    if (!t) throw Errors.tenantNotFound(slug);
    return t;
  };

  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/readyz', async () => ({
    status: 'ready',
    tenants: c.store.listTenants().length,
    llm: process.env.LLM_PROVIDER ?? 'scripted',
  }));

  // ---- Tenants ----
  app.get('/api/v1/tenants', async () =>
    c.store.listTenants().map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      plan: t.plan,
      status: t.status,
      region: t.region,
    })),
  );

  // ---- Live web chat (the runtime ingress) ----
  app.post<{ Params: { slug: string }; Body: { sessionId: string; text: string } }>(
    '/api/v1/chat/:slug/message',
    async (req) => {
      const tenant = tenantBySlug(req.params.slug);
      const { sessionId, text } = req.body;
      const inbound = normalizeWebChat(tenant.id, sessionId, text);
      const result = await c.runtime.handleInbound(inbound);
      return result;
    },
  );

  // ---- Dev helper: follow a magic-link / step-up URL inline (demo convenience) ----
  app.post<{ Body: { url: string } }>('/api/v1/dev/follow', async (req, reply) => {
    const url = req.body.url ?? '';
    const token = url.split('/').pop() ?? '';
    if (url.includes('/verify/')) {
      const { identity } = await c.identity.verifyMagicLink(token);
      return { ok: true, kind: 'verified', user: identity.metadata.name ?? identity.externalUserId };
    }
    if (url.includes('/step-up/')) {
      await c.identity.completeStepUp(token);
      return { ok: true, kind: 'step_up' };
    }
    reply.code(400);
    return { ok: false, error: 'Unrecognized link' };
  });

  // ---- Actions (policy surface) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/actions', async (req) => {
    const t = tenantBySlug(req.params.slug);
    return c.store.listActions(t.id).map((a) => ({
      id: a.id,
      key: a.key,
      label: a.label,
      method: a.httpMethod,
      path: a.path,
      tier: a.tier,
      exposed: a.exposed,
      stepUpRequired: a.stepUpRequired,
      rateLimitPerUserPerHour: a.rateLimitPerUserPerHour,
      description: a.description,
    }));
  });

  // ---- Playbook ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/playbook', async (req) => {
    const t = tenantBySlug(req.params.slug);
    const p = c.store.findActivePlaybook(t.id);
    if (!p) return null;
    return {
      id: p.id,
      version: p.version,
      status: p.status,
      defaultState: p.lifecycle.defaultState,
      states: p.lifecycle.states.map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
        openingBehavior: s.behavior.openingBehavior,
        allowedActions: s.behavior.allowedActionKeys,
        requireConfirmationForTier: s.behavior.requireConfirmationForTier,
      })),
      triggers: p.triggers.map((tr) => ({ id: tr.id, label: tr.label, enabled: tr.enabled })),
      fallbackLadder: p.fallbackLadder,
    };
  });

  // ---- Conversations + turns ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/conversations', async (req) => {
    const t = tenantBySlug(req.params.slug);
    return c.store.listConversations(t.id).map((conv) => {
      const identity = c.store.getIdentityById(conv.identityId);
      return {
        id: conv.id,
        status: conv.status,
        channel: conv.activeChannelType,
        state: conv.currentUserState,
        displayName: identity?.metadata.name ?? identity?.externalUserId,
        lastActivityAt: conv.lastActivityAt,
        turns: c.store.listTurns(t.id, conv.id).length,
      };
    });
  });

  app.get<{ Params: { slug: string; id: string } }>(
    '/api/v1/t/:slug/conversations/:id',
    async (req) => {
      const t = tenantBySlug(req.params.slug);
      const conv = c.store.getConversation(t.id, req.params.id);
      if (!conv) return null;
      return {
        id: conv.id,
        state: conv.currentUserState,
        status: conv.status,
        turns: c.store.listTurns(t.id, conv.id).map((turn) => ({
          role: turn.role,
          text: turn.content.type === 'text' ? turn.content.text : '',
          meta: turn.meta,
          at: turn.createdAt,
        })),
        invocations: c.store.listInvocations(t.id, conv.id),
      };
    },
  );

  // ---- Inbox (escalations) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/inbox', async (req) => {
    const t = tenantBySlug(req.params.slug);
    return c.store.listEscalations(t.id).map((e) => {
      const identity = c.store.getIdentityById(e.identityId);
      return {
        id: e.id,
        conversationId: e.conversationId,
        displayName: identity?.metadata.name ?? identity?.externalUserId,
        reason: e.reason,
        priority: e.priority,
        status: e.status,
        createdAt: e.createdAt,
      };
    });
  });

  // ---- Analytics summary ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/analytics', async (req) => {
    const t = tenantBySlug(req.params.slug);
    const convs = c.store.listConversations(t.id);
    const escalations = c.store.listEscalations(t.id);
    const invocations = c.store.listInvocations(t.id);
    const byAction = new Map<string, { count: number; ok: number }>();
    for (const inv of invocations) {
      if (inv.status !== 'succeeded' && inv.status !== 'failed') continue;
      const e = byAction.get(inv.actionKey) ?? { count: 0, ok: 0 };
      e.count++;
      if (inv.status === 'succeeded') e.ok++;
      byAction.set(inv.actionKey, e);
    }
    const stateDist = new Map<string, number>();
    for (const conv of convs) stateDist.set(conv.currentUserState, (stateDist.get(conv.currentUserState) ?? 0) + 1);
    return {
      totalConversations: convs.length,
      escalations: escalations.length,
      escalationRate: convs.length ? escalations.length / convs.length : 0,
      actionInvocations: invocations.filter((i) => i.status === 'succeeded' || i.status === 'failed').length,
      topActions: [...byAction.entries()].map(([key, v]) => ({
        key,
        count: v.count,
        successRate: v.count ? v.ok / v.count : 0,
      })),
      stateDistribution: [...stateDist.entries()].map(([state, count]) => ({ state, count })),
    };
  });

  // ---- Audit trail ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/audit', async (req) => {
    const t = tenantBySlug(req.params.slug);
    return c.store.listAudit(t.id).slice(0, 100).map((e) => ({
      id: e.id,
      eventType: e.eventType,
      conversationId: e.conversationId,
      payload: e.payload,
      at: e.createdAt,
    }));
  });

  // ---- Channels (secrets masked) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/channels', async (req) => {
    const t = tenantBySlug(req.params.slug);
    return c.store.listChannels(t.id).map((ch) => ({
      id: ch.id,
      type: ch.type,
      status: ch.status,
      inboundEnabled: ch.inboundEnabled,
      outboundEnabled: ch.outboundEnabled,
      // any credential-bearing config field is masked
      config: maskChannelConfig(ch.config as unknown as Record<string, unknown>),
    }));
  });

  // ---- Spec ingestion ----
  app.post<{ Params: { slug: string }; Body: { raw: string; baseUrl?: string; exposeAll?: boolean } }>(
    '/api/v1/t/:slug/specs',
    async (req, reply) => {
      const t = tenantBySlug(req.params.slug);
      const { result } = c.specService.ingest({
        tenantId: t.id,
        raw: req.body.raw,
        baseUrl: req.body.baseUrl,
        exposeAll: req.body.exposeAll,
      });
      if (result.errors.length) {
        reply.code(422);
        return { errors: result.errors };
      }
      return {
        format: result.format,
        actionCount: result.parsedActions.length,
        warnings: result.warnings,
        actions: result.parsedActions.map((a) => ({ key: a.key, tier: a.suggestedTier })),
      };
    },
  );
}

const SECRET_FIELDS = ['accessToken', 'authToken', 'botToken', 'signingSecret', 'webhookVerifyToken'];
function maskChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_FIELDS.includes(k) && typeof v === 'string' ? maskSecret(v) : v;
  }
  return out;
}
