import { maskSecret } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import { verifyIdentityToken } from '@aelio/convox-sdk';
import { ChannelType } from '@aelio/types';
import type { FastifyInstance } from 'fastify';
import { rebuildRuntime, type Container } from '../container.js';
import { normalizeWebChat } from '../channel/normalize.js';
import {
  buildObjectiveStatus,
  findStateManifest,
  readConvoxPhase,
} from '../convox/state-engine.js';
import { randomUUID } from 'node:crypto';
import { externalUserIdFromSession } from '@aelio/demo-saas';
import { getDemoSaasStore } from '../demo-saas/singleton.js';

/** All JSON API routes. Tenant is resolved by slug; every query is tenant-scoped. */
export function registerApiRoutes(app: FastifyInstance, c: Container): void {
  const tenantBySlug = (slug: string) => {
    const t = c.store.getTenantBySlug(slug);
    if (!t) throw Errors.tenantNotFound(slug);
    return t;
  };
  const externalUserIdForSession = (sessionId: string) => `ext_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;

  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/readyz', async () => ({
    status: 'ready',
    tenants: c.store.listTenants().length,
    llm: process.env.LLM_PROVIDER ?? 'scripted',
    memoryEngine: process.env.MEMORY_ENGINE ?? (process.env.SUNJET_URL ? 'sunjet' : 'postgres'),
    sunjet: c.sunjet ? await c.sunjet.health().catch(() => ({ status: 'down' })) : null,
    sunjetDaemon: c.sunjet ? await c.sunjet.daemonHealth() : null,
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

  const daemonKey = process.env.SUNJET_DAEMON_API_KEYS?.split(',')[0]?.trim();

  // ---- Internal: memory rollup (called by sunjet-daemon) ----
  app.post('/api/v1/internal/memory/rollup', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (daemonKey && token !== daemonKey) {
      reply.code(401);
      return { ok: false, error: 'unauthorized' };
    }
    const result = await c.memory.rollupLayers();
    return { ok: true, ...result };
  });

  // ---- Widget identity assertion (Convox SDK signIdentity) ----
  app.post<{ Params: { slug: string }; Body: { identityToken: string } }>(
    '/api/v1/chat/:slug/identify',
    async (req) => {
      const tenant = tenantBySlug(req.params.slug);
      const token = req.body?.identityToken;
      if (!token || typeof token !== 'string') {
        throw Errors.validation({ identityToken: 'required' });
      }
      const apiKey = c.store.getTenantApiKey(tenant.id);
      if (!apiKey) throw Errors.internal('Convox API key not configured for tenant.');
      const assertion = verifyIdentityToken(token, apiKey);
      if (assertion.tenantId !== tenant.slug) {
        throw Errors.unauthorized('Identity token tenant mismatch.');
      }
      const { identity, session } = await c.identity.bindIdentityAssertion(
        tenant.id,
        ChannelType.WebChat,
        assertion,
      );
      return {
        ok: true,
        identityId: identity.id,
        sessionId: session.id,
        verified: true,
      };
    },
  );

  // ---- Objective flows (admin CRUD) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/flows', async (req) => {
    const tenant = tenantBySlug(req.params.slug);
    return c.flowStore.listAll(tenant.id);
  });

  app.put<{
    Params: { slug: string };
    Body: { objectiveKey: string; stateKey: string; steps: Array<{ order: number; toolKey?: string; prompt?: string }>; approved?: boolean; id?: string };
  }>('/api/v1/t/:slug/flows', async (req) => {
    const tenant = tenantBySlug(req.params.slug);
    const { objectiveKey, stateKey, steps, approved, id } = req.body ?? {};
    if (!objectiveKey || !stateKey || !Array.isArray(steps)) {
      throw Errors.validation({ objectiveKey: 'required', stateKey: 'required', steps: 'required' });
    }
    const record = await c.flowStore.upsert(tenant.id, { id, objectiveKey, stateKey, steps, approved });
    c.flows = await c.flowStore.listApproved(tenant.id);
    rebuildRuntime(c, tenant);
    return record;
  });

  // ---- Live web chat (the runtime ingress) ----
  app.post<{ Params: { slug: string }; Body: { sessionId: string; text: string } }>(
    '/api/v1/chat/:slug/message',
    async (req) => {
      const tenant = tenantBySlug(req.params.slug);
      const { sessionId, text } = req.body ?? {};
      if (!sessionId || typeof sessionId !== 'string') {
        throw Errors.validation({ sessionId: 'required' });
      }
      if (!text || typeof text !== 'string') {
        throw Errors.validation({ text: 'required' });
      }
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

  // ---- Dev helper: live Convox tool catalog for a tenant ----
  app.get<{ Params: { slug: string } }>('/api/v1/dev/convox/:slug/tools', async (req) => {
    const tenant = tenantBySlug(req.params.slug);
    c.convoxBridge.syncFromRegistry(tenant.id);
    const actions = c.store.listExposedActions(tenant.id);
    return {
      ok: true,
      slug: req.params.slug,
      liveTools: c.convox.listTools(tenant.id),
      liveStates: c.convox.listStates(tenant.id),
      liveFlows: c.convox.listFlows(tenant.id),
      connections: c.convox.listConnections(tenant.id).length,
      curatedActions: actions.map((a) => a.key),
      policies: actions.map((a) => ({
        key: a.key,
        tier: a.tier,
        exposed: a.exposed,
        stepUpRequired: a.stepUpRequired,
        rateLimitPerUserPerHour: a.rateLimitPerUserPerHour,
      })),
      approvedFlows: c.flows.map((f) => ({
        stateKey: f.stateKey,
        objectiveKey: f.objectiveKey,
        steps: f.steps.length,
      })),
    };
  });

  // ---- Dev helper: guided phase + objectives for a widget session ----
  app.get<{ Params: { slug: string; sessionId: string } }>(
    '/api/v1/dev/convox/:slug/session/:sessionId/phase',
    async (req) => {
      const tenant = tenantBySlug(req.params.slug);
      const ic = c.store.findIdentityChannel(
        tenant.id,
        ChannelType.WebChat,
        req.params.sessionId,
      );
      if (!ic) {
        return { ok: false, reason: 'no_session', sessionId: req.params.sessionId };
      }
      const conv = c.store.findActiveConversation(tenant.id, ic.identityId);
      const states = c.convox.listStates(tenant.id);
      const phase = conv ? readConvoxPhase(conv.metadata) : undefined;
      const manifest = phase ? findStateManifest(states, phase.currentState) : undefined;
      return {
        ok: true,
        sessionId: req.params.sessionId,
        conversationId: conv?.id,
        liveStates: states.map((s) => s.key),
        convoxPhase: phase,
        objectives: phase ? buildObjectiveStatus(manifest, phase) : [],
        currentStateGuidance: manifest?.guidance,
      };
    },
  );

  // ---- Dev helper: read mock SaaS account via live Convox handler ----
  app.post<{ Params: { slug: string }; Body: { sessionId: string } }>(
    '/api/v1/dev/demo/:slug/account',
    async (req) => {
      const tenant = tenantBySlug(req.params.slug);
      const sessionId = req.body?.sessionId;
      if (!sessionId || typeof sessionId !== 'string') {
        throw Errors.validation({ sessionId: 'required' });
      }
      const apiKey = c.store.getTenantApiKey(tenant.id);
      if (!apiKey) throw Errors.internal('Convox API key not configured for tenant.');
      const externalUserId = externalUserIdForSession(sessionId);
      const data = await c.convox.execute(
        tenant.id,
        apiKey,
        {
          tool: 'get_account_status',
          args: {},
          context: {
            invocationId: `dev_${randomUUID()}`,
            tenantId: tenant.slug,
            externalUserId,
            verified: true,
            stepUpValid: false,
          },
        },
      );
      return { ok: true, sessionId, externalUserId, account: data };
    },
  );

  // ---- Dev helper: Postgres-backed SaaS snapshot (direct DB read) ----
  app.get<{ Params: { slug: string }; Querystring: { sessionId?: string } }>(
    '/api/v1/dev/demo/:slug/saas',
    async (req, reply) => {
      tenantBySlug(req.params.slug);
      const sessionId = req.query.sessionId;
      if (!sessionId || typeof sessionId !== 'string') {
        throw Errors.validation({ sessionId: 'required query param' });
      }
      const store = await getDemoSaasStore();
      if (!store) {
        reply.code(503);
        return { ok: false, error: 'DATABASE_URL not configured' };
      }
      const externalUserId = externalUserIdFromSession(sessionId);
      const snapshot = await store.getSnapshot(externalUserId);
      return { ok: true, sessionId, externalUserId, ...snapshot };
    },
  );

  app.post<{ Params: { slug: string }; Body: { sessionId: string } }>(
    '/api/v1/dev/demo/:slug/reset',
    async (req, reply) => {
      tenantBySlug(req.params.slug);
      const sessionId = req.body?.sessionId;
      if (!sessionId || typeof sessionId !== 'string') {
        throw Errors.validation({ sessionId: 'required' });
      }
      const store = await getDemoSaasStore();
      if (!store) {
        reply.code(503);
        return { ok: false, error: 'DATABASE_URL not configured' };
      }
      const externalUserId = externalUserIdFromSession(sessionId);
      await store.resetAccount(externalUserId);
      const snapshot = await store.getSnapshot(externalUserId);
      return { ok: true, sessionId, externalUserId, ...snapshot };
    },
  );

  app.delete<{
    Params: { slug: string; reportId: string };
    Querystring: { sessionId?: string };
  }>('/api/v1/dev/demo/:slug/reports/:reportId', async (req, reply) => {
    tenantBySlug(req.params.slug);
    const sessionId = req.query.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      throw Errors.validation({ sessionId: 'required query param' });
    }
    const store = await getDemoSaasStore();
    if (!store) {
      reply.code(503);
      return { ok: false, error: 'DATABASE_URL not configured' };
    }
    const externalUserId = externalUserIdFromSession(sessionId);
    const deleted = await store.deleteReport(externalUserId, req.params.reportId);
    const snapshot = await store.getSnapshot(externalUserId);
    return { ok: deleted, sessionId, externalUserId, ...snapshot };
  });

  app.delete<{
    Params: { slug: string; member: string };
    Querystring: { sessionId?: string };
  }>('/api/v1/dev/demo/:slug/shares/:member', async (req, reply) => {
    tenantBySlug(req.params.slug);
    const sessionId = req.query.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      throw Errors.validation({ sessionId: 'required query param' });
    }
    const store = await getDemoSaasStore();
    if (!store) {
      reply.code(503);
      return { ok: false, error: 'DATABASE_URL not configured' };
    }
    const externalUserId = externalUserIdFromSession(sessionId);
    const result = await store.revokeShare(externalUserId, decodeURIComponent(req.params.member));
    const snapshot = await store.getSnapshot(externalUserId);
    return { ok: result.revoked, sessionId, externalUserId, ...snapshot };
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

}

const SECRET_FIELDS = ['accessToken', 'authToken', 'botToken', 'signingSecret', 'webhookVerifyToken'];
function maskChannelConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_FIELDS.includes(k) && typeof v === 'string' ? maskSecret(v) : v;
  }
  return out;
}
