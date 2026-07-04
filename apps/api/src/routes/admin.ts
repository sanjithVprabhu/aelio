import { hashPassword, maskSecret, randomToken } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import {
  ActionTier,
  ConversationStatus,
  OnboardingStep,
  PlaybookStatus,
  type FallbackStep,
  type PlaybookLifecycle,
  type PlaybookTrigger,
  type Tenant,
} from '@aelio/types';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { EvalRunner } from '../eval/eval-runner.js';
import { uuid } from '../util/id.js';

/** Layer 6 admin surface: the full config + ops REST API the dashboard consumes. */
export function registerAdminRoutes(app: FastifyInstance, c: Container): void {
  const evalRunner = new EvalRunner(c);
  const t = (slug: string): Tenant => {
    const tenant = c.store.getTenantBySlug(slug);
    if (!tenant) throw Errors.tenantNotFound(slug);
    return tenant;
  };

  // ---- Overview ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/overview', async (req) => {
    const tn = t(req.params.slug);
    const convs = c.store.listConversations(tn.id);
    const resolved = convs.filter((cv) => cv.status === ConversationStatus.Resolved).length;
    const states = new Map<string, number>();
    for (const cv of convs) states.set(cv.currentUserState, (states.get(cv.currentUserState) ?? 0) + 1);
    return {
      conversations: convs.length,
      escalations: c.store.listEscalations(tn.id).length,
      actionsExposed: c.store.listExposedActions(tn.id).length,
      resolutionRate: convs.length ? resolved / convs.length : 0,
      states: [...states.entries()].map(([state, count]) => ({ state, count })),
    };
  });

  // ---- End users ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/end-users', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listIdentities(tn.id).map((i) => ({
      id: i.id,
      externalUserId: i.externalUserId,
      displayName: i.metadata.name ?? i.externalUserId,
      verificationStatus: i.verificationStatus,
      currentUserState: i.currentUserState,
      plan: i.metadata.plan,
    }));
  });

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/end-users/:id', async (req) => {
    const tn = t(req.params.slug);
    const i = c.store.getIdentity(tn.id, req.params.id);
    if (!i) return null;
    return {
      id: i.id,
      externalUserId: i.externalUserId,
      displayName: i.metadata.name,
      verificationStatus: i.verificationStatus,
      verifiedAt: i.verifiedAt,
      currentUserState: i.currentUserState,
      stateConfidence: i.stateConfidence,
      channels: c.store.listIdentityChannels(i.id).map((ch) => ({ type: ch.channelType, identifier: ch.identifier, trusted: ch.trusted })),
      facts: c.store.listFacts(tn.id, i.id),
    };
  });

  app.delete<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/end-users/:id/session', async (req) => {
    const tn = t(req.params.slug);
    await c.identity.revokeSession(tn.id, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/end-users/:id/reset-verification', async (req) => {
    const tn = t(req.params.slug);
    const i = c.store.getIdentity(tn.id, req.params.id);
    if (i) {
      i.verificationStatus = 'unverified' as never;
      i.encryptedAccessToken = undefined;
      c.store.putIdentity(i);
      for (const ch of c.store.listIdentityChannels(i.id)) {
        ch.trusted = false;
        c.store.putIdentityChannel(ch);
      }
      await c.identity.revokeSession(tn.id, i.id);
    }
    return { ok: true };
  });

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/end-users/:id/audit', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listAudit(tn.id).filter((e) => e.endUserId === req.params.id);
  });

  // ---- Settings + BYOK ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/settings', async (req) => {
    const tn = t(req.params.slug);
    return {
      llm: { mode: tn.llmConfig.mode, provider: tn.llmConfig.provider, model: tn.llmConfig.model },
      compliance: { region: tn.region, retention: '1y', piiRedaction: true },
      plan: tn.plan,
    };
  });

  app.patch<{ Params: { slug: string }; Body: { provider?: string; model?: string; mode?: string } }>(
    '/api/v1/t/:slug/settings/llm',
    async (req) => {
      const tn = t(req.params.slug);
      tn.llmConfig = {
        mode: (req.body.mode as 'platform') ?? tn.llmConfig.mode,
        provider: (req.body.provider as never) ?? tn.llmConfig.provider,
        model: req.body.model ?? tn.llmConfig.model,
      } as typeof tn.llmConfig;
      c.store.putTenant(tn);
      return { ok: true, llm: tn.llmConfig };
    },
  );

  app.post<{ Params: { slug: string } }>('/api/v1/t/:slug/settings/llm/test', async (req) => {
    const tn = t(req.params.slug);
    // Cheap probe through the configured client.
    try {
      const res = await c.llm.complete({
        messages: [{ role: 'user', content: 'ping' }],
        tenantId: tn.id,
        conversationId: 'probe',
        maxTokens: 8,
      });
      return { ok: true, model: res.model, provider: res.provider };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  });

  // ---- GDPR ----
  app.post<{ Params: { slug: string }; Body: { externalUserId: string } }>(
    '/api/v1/t/:slug/settings/compliance/dsar',
    async (req) => {
      const tn = t(req.params.slug);
      const identity = c.store.findIdentityByExternal(tn.id, req.body.externalUserId);
      if (!identity) return { found: false };
      return {
        found: true,
        identity: { id: identity.id, externalUserId: identity.externalUserId, metadata: identity.metadata },
        conversations: c.store.listConversations(tn.id).filter((cv) => cv.identityId === identity.id),
        facts: c.store.listFacts(tn.id, identity.id),
      };
    },
  );

  app.post<{ Params: { slug: string }; Body: { externalUserId: string } }>(
    '/api/v1/t/:slug/settings/compliance/erasure',
    async (req) => {
      const tn = t(req.params.slug);
      const identity = c.store.findIdentityByExternal(tn.id, req.body.externalUserId);
      if (!identity) return { erased: false };
      await c.identity.revokeSession(tn.id, identity.id);
      c.store.eraseIdentity(tn.id, identity.id);
      c.store.addAudit({
        id: uuid(),
        tenantId: tn.id,
        eventType: 'gdpr.erasure',
        payload: { externalUserId: req.body.externalUserId },
        createdAt: new Date(),
      });
      return { erased: true };
    },
  );

  // ---- Convox registry (live tools from customer SDK connections) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/convox/tools', async (req) => {
    const tn = t(req.params.slug);
    c.convoxBridge.syncFromRegistry(tn.id);
    return {
      connections: c.convox.listConnections(tn.id).map((conn) => ({
        connectionId: conn.connectionId,
        instanceId: conn.instanceId,
        toolCount: conn.tools.size,
      })),
      liveTools: c.convox.listTools(tn.id),
      liveStates: c.convox.listStates(tn.id),
      curatedActions: c.store.listActions(tn.id),
    };
  });

  // Legacy playbook routes — retired in the Convox architecture.
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/playbooks', async () => []);

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/playbooks/:id/preflight', async (req) => {
    const tn = t(req.params.slug);
    const p = c.store.getPlaybook(tn.id, req.params.id);
    if (!p) return null;
    return { ok: false, reason: 'Playbooks are retired — use Convox tool registration.' };
  });

  app.post<{ Params: { slug: string; id: string } }>(
    '/api/v1/t/:slug/playbooks/:id/deploy',
    async (_req, reply) => {
      reply.code(410);
      return { ok: false, error: 'Playbooks are retired — register tools via Convox SDK.' };
    },
  );

  // ---- Actions policy editor ----
  app.patch<{ Params: { slug: string; id: string }; Body: Record<string, unknown> }>(
    '/api/v1/t/:slug/actions/:id',
    async (req) => {
      const tn = t(req.params.slug);
      const action = c.store.getAction(tn.id, req.params.id);
      if (!action) throw Errors.notFound('Action', req.params.id);
      const b = req.body;
      if (typeof b.exposed === 'boolean') action.exposed = b.exposed;
      if (typeof b.tier === 'number') action.tier = b.tier as ActionTier;
      if (typeof b.description === 'string') action.description = b.description;
      if (typeof b.confirmationCopy === 'string') action.confirmationCopy = b.confirmationCopy;
      if (typeof b.postActionMessage === 'string') action.postActionMessage = b.postActionMessage;
      if (typeof b.rateLimitPerUserPerHour === 'number') action.rateLimitPerUserPerHour = b.rateLimitPerUserPerHour;
      if (typeof b.stepUpRequired === 'boolean') action.stepUpRequired = b.stepUpRequired;
      if (Array.isArray(b.requiredPermissions)) action.requiredPermissions = b.requiredPermissions as string[];
      action.updatedAt = new Date();
      c.store.putAction(action);
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string }; Body: { keys: string[]; exposed: boolean } }>(
    '/api/v1/t/:slug/actions/bulk-expose',
    async (req) => {
      const tn = t(req.params.slug);
      let n = 0;
      for (const key of req.body.keys) {
        const a = c.store.getActionByKey(tn.id, key);
        if (a) {
          a.exposed = req.body.exposed;
          c.store.putAction(a);
          n++;
        }
      }
      return { ok: true, updated: n };
    },
  );

  app.post<{ Params: { slug: string; id: string }; Body: { args?: Record<string, unknown>; externalUserId?: string } }>(
    '/api/v1/t/:slug/actions/:id/test',
    async (req, reply) => {
      const tn = t(req.params.slug);
      const action = c.store.getAction(tn.id, req.params.id);
      if (!action) throw Errors.notFound('Action', req.params.id);
      if (action.tier !== ActionTier.Read) {
        reply.code(400);
        return { ok: false, error: 'Only Tier 0 (read) actions can be test-called.' };
      }
      const apiKey = c.store.getTenantApiKey(tn.id);
      if (!apiKey) {
        reply.code(503);
        return { ok: false, error: 'Tenant Convox API key is not configured.' };
      }
      const data = await c.convox.execute(tn.id, apiKey, {
        tool: action.key,
        args: req.body.args ?? {},
        context: {
          invocationId: `admin_test_${uuid()}`,
          tenantId: tn.id,
          externalUserId: req.body.externalUserId ?? 'ext_demo',
          verified: true,
          stepUpValid: false,
        },
      });
      return { ok: true, data };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/actions/:id/invocations', async (req) => {
    const tn = t(req.params.slug);
    const action = c.store.getAction(tn.id, req.params.id);
    if (!action) return [];
    return c.store.listInvocations(tn.id).filter((i) => i.actionKey === action.key);
  });

  // ---- Knowledge base ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/kb/collections', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listCollections(tn.id).map((col) => ({
      id: col.id,
      name: col.name,
      description: col.description,
      sources: c.store.listSources(tn.id, col.id).length,
      chunks: c.store.listChunks(tn.id, [col.id]).length,
      embeddingModel: col.embeddingModel,
    }));
  });

  app.post<{ Params: { slug: string }; Body: { name: string; description?: string } }>(
    '/api/v1/t/:slug/kb/collections',
    async (_req, reply) => {
      reply.code(410);
      return { ok: false, error: 'Knowledge base is retired pending the VSS memory layer.' };
    },
  );

  app.post<{ Params: { slug: string; id: string }; Body: { type: 'file' | 'url' | 'text'; name: string; url?: string; content: string } }>(
    '/api/v1/t/:slug/kb/collections/:id/sources',
    async (_req, reply) => {
      reply.code(410);
      return { ok: false, error: 'Knowledge base is retired pending the VSS memory layer.' };
    },
  );

  app.delete<{ Params: { slug: string; id: string; sid: string } }>(
    '/api/v1/t/:slug/kb/collections/:id/sources/:sid',
    async (req) => {
      const tn = t(req.params.slug);
      c.store.deleteSource(tn.id, req.params.sid);
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string; id: string }; Body: { query: string } }>(
    '/api/v1/t/:slug/kb/collections/:id/test',
    async (req) => {
      const tn = t(req.params.slug);
      void tn;
      void req;
      return { chunks: [] };
    },
  );

  // ---- Inbox actions ----
  app.post<{ Params: { slug: string; id: string }; Body: { agentId?: string; agentName?: string } }>(
    '/api/v1/t/:slug/inbox/:id/claim',
    async (req) => {
      const tn = t(req.params.slug);
      const e = c.store.getEscalation(tn.id, req.params.id);
      if (!e) throw Errors.notFound('Escalation', req.params.id);
      e.status = 'assigned';
      e.assignedToId = req.body.agentId ?? 'agent';
      e.assignedToName = req.body.agentName ?? 'Agent';
      e.claimedAt = new Date();
      c.store.putEscalation(e);
      const conv = c.store.getConversation(tn.id, e.conversationId);
      if (conv) {
        conv.status = ConversationStatus.HandedOff;
        c.store.putConversation(conv);
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string; id: string }; Body: { text: string } }>(
    '/api/v1/t/:slug/inbox/:id/reply',
    async (req) => {
      const tn = t(req.params.slug);
      const e = c.store.getEscalation(tn.id, req.params.id);
      if (!e) throw Errors.notFound('Escalation', req.params.id);
      const conv = c.store.getConversation(tn.id, e.conversationId);
      if (conv) {
        c.store.addTurn({
          id: uuid(),
          conversationId: conv.id,
          tenantId: tn.id,
          role: 'assistant',
          content: { type: 'text', text: req.body.text },
          channelType: conv.activeChannelType,
          meta: { agent: true },
          createdAt: new Date(),
        });
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/inbox/:id/resolve', async (req) => {
    const tn = t(req.params.slug);
    const e = c.store.getEscalation(tn.id, req.params.id);
    if (!e) throw Errors.notFound('Escalation', req.params.id);
    e.status = 'resolved';
    e.resolvedAt = new Date();
    c.store.putEscalation(e);
    const conv = c.store.getConversation(tn.id, e.conversationId);
    if (conv) {
      conv.status = ConversationStatus.Resolved;
      conv.resolvedAt = new Date();
      c.store.putConversation(conv);
    }
    return { ok: true };
  });

  app.post<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/inbox/:id/urgent', async (req) => {
    const tn = t(req.params.slug);
    const e = c.store.getEscalation(tn.id, req.params.id);
    if (!e) throw Errors.notFound('Escalation', req.params.id);
    e.priority = 'urgent';
    c.store.putEscalation(e);
    return { ok: true };
  });

  // ---- Onboarding state machine ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/onboarding', async (req) => {
    const tn = t(req.params.slug);
    return c.store.getOnboarding(tn.id) ?? null;
  });

  app.post<{ Params: { slug: string }; Body: { currentStep: OnboardingStep } }>(
    '/api/v1/t/:slug/onboarding/state',
    async (req) => {
      const tn = t(req.params.slug);
      const existing = c.store.getOnboarding(tn.id);
      const completed = new Set(existing?.completedSteps ?? []);
      if (existing) completed.add(existing.currentStep);
      c.store.putOnboarding({
        tenantId: tn.id,
        currentStep: req.body.currentStep,
        completedSteps: [...completed],
        specId: existing?.specId,
        channelId: existing?.channelId,
        playbookId: existing?.playbookId,
        updatedAt: new Date(),
      });
      return { ok: true };
    },
  );

  app.post<{ Params: { slug: string } }>('/api/v1/t/:slug/onboarding/go-live', async (req) => {
    const tn = t(req.params.slug);
    const checklist = [
      { label: '≥1 action exposed', passed: c.store.listExposedActions(tn.id).length > 0, blocker: true },
      { label: '≥1 channel connected', passed: c.store.listChannels(tn.id).length > 0, blocker: true },
      {
        label: 'Convox tools registered',
        passed: c.convox.listTools(tn.id).length > 0,
        blocker: true,
      },
      { label: 'SOC2 report uploaded', passed: false, blocker: false },
    ];
    const ready = checklist.every((c2) => !c2.blocker || c2.passed);
    if (ready) {
      tn.status = 'active' as never;
      c.store.putTenant(tn);
    }
    return { ready, checklist };
  });

  // ---- Evals ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/evals/suites', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listEvalSuites(tn.id).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      scenarios: c.store.listEvalScenarios(tn.id, s.id).length,
    }));
  });

  app.post<{ Params: { slug: string }; Body: { name: string; description?: string } }>(
    '/api/v1/t/:slug/evals/suites',
    async (req) => {
      const tn = t(req.params.slug);
      const suite = { id: uuid(), tenantId: tn.id, name: req.body.name, description: req.body.description ?? '', createdAt: new Date() };
      c.store.putEvalSuite(suite);
      return { id: suite.id };
    },
  );

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/evals/suites/:id/scenarios', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listEvalScenarios(tn.id, req.params.id);
  });

  app.post<{ Params: { slug: string; id: string }; Body: { name: string; steps: never[]; expectedFinalState?: string } }>(
    '/api/v1/t/:slug/evals/suites/:id/scenarios',
    async (req) => {
      const tn = t(req.params.slug);
      const sc = {
        id: uuid(),
        suiteId: req.params.id,
        tenantId: tn.id,
        name: req.body.name,
        steps: req.body.steps,
        expectedFinalState: req.body.expectedFinalState,
        createdAt: new Date(),
      };
      c.store.putEvalScenario(sc);
      return { id: sc.id };
    },
  );

  app.post<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/evals/suites/:id/run', async (req) => {
    const tn = t(req.params.slug);
    const run = await evalRunner.runSuite(tn.id, req.params.id, 'convox');
    return run;
  });

  app.get<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/evals/runs/:id', async (req) => {
    const tn = t(req.params.slug);
    return c.store.getEvalRun(tn.id, req.params.id) ?? null;
  });

  app.post<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/playbooks/:id/archive', async (req) => {
    const tn = t(req.params.slug);
    void tn;
    void req;
    return { ok: false, error: 'Playbooks are retired.' };
  });

  // ---- Playbook editing (states / triggers / fallback / templates) ----
  app.put<{
    Params: { slug: string; id: string };
    Body: {
      lifecycle?: PlaybookLifecycle;
      triggers?: PlaybookTrigger[];
      fallbackLadder?: FallbackStep[];
      messageTemplates?: Record<string, string>;
      version?: string;
    };
  }>('/api/v1/t/:slug/playbooks/:id', async (req) => {
    const tn = t(req.params.slug);
    const p = c.store.getPlaybook(tn.id, req.params.id);
    if (!p) throw Errors.notFound('Playbook', req.params.id);
    if (req.body.lifecycle) {
      // Merge: preserve behavior fields the editor doesn't manage (persona, tone,
      // kbScope, etc.) when the incoming state omits or blanks them.
      const prior = new Map(p.lifecycle.states.map((s) => [s.key, s.behavior]));
      for (const state of req.body.lifecycle.states) {
        const old = prior.get(state.key);
        if (old) {
          state.behavior = {
            ...old,
            ...state.behavior,
            persona: state.behavior.persona?.trim() ? state.behavior.persona : old.persona,
            toneGuidelines: state.behavior.toneGuidelines?.length
              ? state.behavior.toneGuidelines
              : old.toneGuidelines,
            kbScopeIds: state.behavior.kbScopeIds ?? old.kbScopeIds,
            skillPacks: state.behavior.skillPacks ?? old.skillPacks,
          };
        }
      }
      p.lifecycle = req.body.lifecycle;
    }
    if (req.body.triggers) p.triggers = req.body.triggers;
    if (req.body.fallbackLadder) p.fallbackLadder = req.body.fallbackLadder;
    if (req.body.messageTemplates) p.messageTemplates = req.body.messageTemplates;
    if (req.body.version) p.version = req.body.version;
    c.store.putPlaybook(p);
    return { ok: true };
  });

  // Create a new draft version cloned from the current active playbook.
  app.post<{ Params: { slug: string }; Body: { version?: string } }>(
    '/api/v1/t/:slug/playbooks',
    async (req) => {
      const tn = t(req.params.slug);
      const active = c.store.findActivePlaybook(tn.id);
      if (!active) throw Errors.notFound('Playbook', 'active');
      const draft = {
        ...structuredClone(active),
        id: uuid(),
        version: req.body.version ?? bumpVersion(active.version),
        status: PlaybookStatus.Draft,
        publishedAt: undefined,
        createdAt: new Date(),
      };
      c.store.putPlaybook(draft);
      return { id: draft.id, version: draft.version, status: draft.status };
    },
  );

  // ---- Team management ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/team/members', async (req) => {
    const tn = t(req.params.slug);
    return c.store.listAdminUsers(tn.id).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      joinedAt: u.createdAt,
    }));
  });

  app.post<{ Params: { slug: string }; Body: { email: string; name: string; role?: 'admin' | 'member' } }>(
    '/api/v1/t/:slug/team/invites',
    async (req, reply) => {
      const tn = t(req.params.slug);
      if (c.store.getAdminUserByEmail(req.body.email)) {
        reply.code(409);
        return { error: 'A user with that email already exists.' };
      }
      const tempPassword = randomToken().slice(0, 12);
      c.store.putAdminUser({
        id: uuid(),
        tenantId: tn.id,
        email: req.body.email,
        name: req.body.name,
        role: req.body.role ?? 'member',
        passwordHash: hashPassword(tempPassword),
        createdAt: new Date(),
      });
      // In production this is emailed as a magic invite, never returned.
      return { invited: true, devTempPassword: tempPassword };
    },
  );

  app.patch<{ Params: { slug: string; id: string }; Body: { role: 'owner' | 'admin' | 'member' } }>(
    '/api/v1/t/:slug/team/members/:id/role',
    async (req) => {
      const tn = t(req.params.slug);
      const u = c.store.getAdminUser(req.params.id);
      if (!u || u.tenantId !== tn.id) throw Errors.notFound('Member', req.params.id);
      u.role = req.body.role;
      c.store.putAdminUser(u);
      return { ok: true };
    },
  );

  app.delete<{ Params: { slug: string; id: string } }>('/api/v1/t/:slug/team/members/:id', async (req) => {
    const tn = t(req.params.slug);
    c.store.deleteAdminUser(tn.id, req.params.id);
    return { ok: true };
  });

  // ---- Billing (Stripe when keyed, else computed from usage) ----
  app.get<{ Params: { slug: string } }>('/api/v1/t/:slug/billing', async (req) => {
    const tn = t(req.params.slug);
    const convs = c.store.listConversations(tn.id);
    const invocations = c.store.listInvocations(tn.id).filter((i) => i.status === 'succeeded');
    const seats = c.store.listAdminUsers(tn.id).length;
    const usage = {
      conversations: convs.length,
      actionInvocations: invocations.length,
      seats,
    };
    const limits: Record<string, number> = { lite: 1000, pro: 10000, max: 100000, enterprise: 1_000_000 };
    if (process.env.STRIPE_SECRET_KEY) {
      // Real Stripe subscription/usage lookup would go here using the tenant's
      // Stripe customer id; the shape returned is identical.
      return { plan: tn.plan, provider: 'stripe', usage, conversationLimit: limits[tn.plan] ?? 1000 };
    }
    return { plan: tn.plan, provider: 'computed', usage, conversationLimit: limits[tn.plan] ?? 1000 };
  });

  // Keep a masked-secret reference handy for the channels surface (also in api.ts).
  void maskSecret;
}

function bumpVersion(v: string): string {
  const parts = v.split('.').map(Number);
  parts[parts.length - 1] = (parts[parts.length - 1] ?? 0) + 1;
  return parts.join('.');
}
