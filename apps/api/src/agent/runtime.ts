import { createLogger } from '@aelio/logger';
import {
  ChannelType,
  ConversationStatus,
  type BehaviorBundle,
  type Conversation,
  type EndUserIdentity,
  type EndUserSession,
  type LLMClient,
  type LLMMessage,
  type Playbook,
  type Turn,
  type UserContext,
} from '@aelio/types';
import type { Store } from '../store/store.js';
import type { IdentityService } from '../identity/identity-service.js';
import type { PolicyService } from '../policy/policy-service.js';
import { evaluateTriggers } from '../playbook/trigger-engine.js';
import { inferState } from '../playbook/state-inference.js';
import { FallbackLadder } from '../playbook/fallback.js';
import { PlaybookService } from '../playbook/playbook-service.js';
import { RagService } from '../kb/rag-service.js';
import { MemoryService } from './memory.js';
import { Telemetry } from './telemetry.js';
import { buildAgentContext, toolsForBehavior } from './context-builder.js';
import { uuid } from '../util/id.js';

const MAX_TOOL_ITERATIONS = 5;
const AFFIRM = ['yes', 'confirm', 'go ahead', 'do it', 'ok', 'okay', 'sure', 'yep', 'proceed', 'confirmed', 'please do', 'done'];
const DENY = ['no', "don't", 'stop', 'cancel that', 'nevermind', 'never mind'];

export interface InboundContext {
  tenantId: string;
  channelType: ChannelType;
  identifier: string; // who the message is from (phone, web id, etc.)
  text: string;
}

export interface RuntimeReply {
  kind: 'text' | 'magic_link' | 'step_up' | 'handoff';
  text: string;
  url?: string;
}

export interface RuntimeResult {
  conversationId?: string;
  identityId?: string;
  replies: RuntimeReply[];
  state: string;
  stateChanged: boolean;
  confidence: number;
  actions: Array<{ key: string; tier: number; status: string }>;
  triggersFired: string[];
  escalated: boolean;
  needsVerification: boolean;
}

interface AwaitingAction {
  actionKey: string;
  args: Record<string, unknown>;
}

/**
 * The agent runtime — the critical path for every inbound message. It stitches
 * Layers 2–5 together: identity/session → conversation → state inference →
 * playbook + triggers → LLM tool loop (through the policy gates) → persist.
 */
export class AgentRuntime {
  constructor(
    private readonly store: Store,
    private readonly identity: IdentityService,
    private readonly policy: PolicyService,
    private readonly llm: LLMClient,
    private readonly rag: RagService,
    private readonly memory: MemoryService,
    private readonly fallback: FallbackLadder,
    private readonly telemetry: Telemetry,
    private readonly playbooks: PlaybookService,
  ) {}

  async handleInbound(input: InboundContext): Promise<RuntimeResult> {
    const tenant = this.store.getTenant(input.tenantId);
    if (!tenant) {
      return this.empty('unverified', [{ kind: 'text', text: 'Unknown tenant.' }]);
    }
    const log = createLogger({ tenantId: input.tenantId, channelType: input.channelType });

    // 1. Identity & session.
    const resolved = await this.identity.resolveOrInitiate(
      input.tenantId,
      input.channelType,
      input.identifier,
    );
    if (resolved.status === 'needs_verification') {
      return {
        ...this.empty('unverified', [
          {
            kind: 'magic_link',
            text: `Before I can help with your account, please verify it's you: ${resolved.magicLinkUrl}`,
            url: resolved.magicLinkUrl,
          },
        ]),
        identityId: resolved.identity.id,
        needsVerification: true,
      };
    }
    const startedAt = Date.now();
    const identity = resolved.identity;
    const session = resolved.session;
    const userContext = this.userContext(identity);

    // 2. Conversation + playbook selection (honors gradual/shadow experiments,
    //    bucketed deterministically per user so the experience is stable).
    const selected = this.playbooks.select(input.tenantId, identity.id);
    if (!selected) {
      return this.empty('active', [{ kind: 'text', text: 'No playbook is configured yet.' }]);
    }
    const playbook = selected.playbook;
    const conversation = this.loadConversation(identity, input.channelType, playbook);
    const log2 = log.child({ conversationId: conversation.id, identityId: identity.id });

    this.persistTurn(conversation, 'user', input.text, input.channelType);

    // 2b. Pending confirmation / step-up resume (multi-turn safety flow).
    const awaiting = conversation.metadata.awaiting as AwaitingAction | undefined;
    if (awaiting) {
      const handled = await this.handleAwaiting(conversation, identity, session, awaiting, input);
      if (handled) return handled;
    }

    // 3. State inference.
    const recentUserMessages = this.store
      .listTurns(input.tenantId, conversation.id)
      .filter((t) => t.role === 'user' && t.content.type === 'text')
      .slice(-6)
      .map((t) => (t.content.type === 'text' ? t.content.text : ''));
    const actionHistory = this.store.listInvocations(input.tenantId, conversation.id);
    const inference = inferState(
      {
        currentState: identity.currentUserState,
        currentConfidence: identity.stateConfidence,
        verified: true,
        userContext,
        recentUserMessages,
        actionHistory,
      },
      playbook,
    );
    if (inference.changed) {
      identity.currentUserState = inference.state;
      identity.stateConfidence = inference.confidence;
      identity.stateInferredAt = new Date();
      this.store.putIdentity(identity);
      conversation.currentUserState = inference.state;
    }

    // 4 + 5. Triggers (macro behavior bounding).
    const triggersFired: string[] = [];
    const escalated = false;
    const fired = evaluateTriggers(playbook.triggers, {
      event: { type: 'message_received' },
      message: input.text,
      currentState: conversation.currentUserState,
      actionHistory,
    });
    const prependMessages: string[] = [];
    for (const f of fired) {
      triggersFired.push(f.label);
      if (f.action.type === 'transition_state') {
        conversation.currentUserState = f.action.targetState;
        identity.currentUserState = f.action.targetState;
        this.store.putIdentity(identity);
      } else if (f.action.type === 'escalate_to_human') {
        return this.escalate(conversation, identity, f.action.reason, f.action.priority, triggersFired);
      } else if (f.action.type === 'send_message') {
        const tmpl = playbook.messageTemplates[f.action.templateKey];
        if (tmpl) prependMessages.push(tmpl);
      }
    }

    // 6. Build context (behavior bundle for the resolved state + allowed tools +
    //    RAG retrieval over the state's KB scope + known long-term facts).
    const behavior = this.behaviorFor(playbook, conversation.currentUserState);
    const tools = toolsForBehavior(behavior, this.store.listExposedActions(input.tenantId));
    const kbChunks = await this.rag.retrieve(input.tenantId, input.text, behavior.kbScopeIds);
    const facts = this.memory
      .facts(input.tenantId, identity.id)
      .map((f) => ({ key: f.key, value: f.value }));
    const ctx = buildAgentContext({
      behavior,
      tenantName: tenant.name,
      userContext,
      history: this.store.listTurns(input.tenantId, conversation.id).slice(0, -1),
      currentMessage: input.text,
      tools,
      kbChunks,
      facts,
    });

    // 7 + 8. LLM tool loop through the policy gates.
    const loop = await this.toolLoop(ctx.systemPrompt, ctx.messages, ctx.tools, {
      conversation,
      identity,
      session,
      behavior,
      userContext,
    });

    // 9. Confidence / fallback ladder when the agent produced nothing useful.
    let fallbackTriggered = false;
    let finalText = [...prependMessages, loop.finalText].filter(Boolean).join('\n\n');
    if (!loop.interrupt && !loop.finalText && loop.actions.length === 0) {
      const fb = await this.fallback.run(
        {
          conversationId: conversation.id,
          originalMessage: input.text,
          availableActions: this.store.listExposedActions(input.tenantId),
        },
        playbook.fallbackLadder,
      );
      fallbackTriggered = true;
      if (fb.shouldEscalate) {
        return this.escalate(conversation, identity, 'Fallback ladder exhausted', 'normal', triggersFired);
      }
      finalText = fb.responseMessage;
    }

    const replies: RuntimeReply[] = [];
    if (loop.interrupt?.kind === 'step_up') {
      replies.push({ kind: 'step_up', text: loop.interrupt.text, url: loop.interrupt.url });
    } else {
      replies.push({ kind: 'text', text: finalText || "I'm not sure how to help with that yet." });
    }

    // 10. Persist assistant turn.
    this.persistTurn(conversation, 'assistant', replies[0]!.text, input.channelType, {
      model: loop.model,
      actions: loop.actions,
      state: conversation.currentUserState,
    });
    conversation.lastActivityAt = new Date();
    this.store.putConversation(conversation);

    // Emit per-turn telemetry (drives analytics + the failed-turns log).
    this.telemetry.emit({
      eventType: 'turn.completed',
      tenantId: input.tenantId,
      conversationId: conversation.id,
      identityId: identity.id,
      playbookVersion: playbook.version,
      userState: conversation.currentUserState,
      stateChanged: inference.changed,
      model: loop.model,
      inputTokens: loop.usage.inputTokens,
      outputTokens: loop.usage.outputTokens,
      llmLatencyMs: 0,
      toolCallCount: loop.actions.length,
      toolCallResults: loop.actions.map((a) => ({
        actionKey: a.key,
        success: a.status === 'succeeded',
        tier: a.tier,
      })),
      kbChunksRetrieved: kbChunks.length,
      fallbackTriggered,
      triggersFired,
      escalated,
      channelType: input.channelType,
      totalLatencyMs: Date.now() - startedAt,
      playbookIsExperiment: selected.isExperiment,
    });
    void log2;

    return {
      conversationId: conversation.id,
      identityId: identity.id,
      replies,
      state: conversation.currentUserState,
      stateChanged: inference.changed,
      confidence: identity.stateConfidence,
      actions: loop.actions,
      triggersFired,
      escalated,
      needsVerification: false,
    };
  }

  // ---- tool loop ----
  private async toolLoop(
    systemPrompt: string,
    initialMessages: LLMMessage[],
    tools: ReturnType<typeof toolsForBehavior>,
    ctx: {
      conversation: Conversation;
      identity: EndUserIdentity;
      session: EndUserSession;
      behavior: BehaviorBundle;
      userContext?: UserContext;
    },
  ): Promise<{
    finalText: string;
    actions: Array<{ key: string; tier: number; status: string }>;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
    interrupt?: { kind: 'step_up'; text: string; url?: string };
  }> {
    const messages = [...initialMessages];
    const actions: Array<{ key: string; tier: number; status: string }> = [];
    let model = 'scripted';
    const usage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await this.llm.complete({
        messages,
        systemPrompt,
        tools,
        tenantId: ctx.conversation.tenantId,
        conversationId: ctx.conversation.id,
      });
      model = resp.model;
      usage.inputTokens += resp.inputTokens;
      usage.outputTokens += resp.outputTokens;

      if (!resp.toolCalls || resp.toolCalls.length === 0) {
        return { finalText: resp.content, actions, model, usage };
      }

      const toolResults: LLMMessage = { role: 'tool', content: [] };
      for (const tc of resp.toolCalls) {
        const result = await this.policy.executeAction({
          tenantId: ctx.conversation.tenantId,
          identity: ctx.identity,
          session: ctx.session,
          actionKey: tc.name,
          args: tc.args,
          conversationId: ctx.conversation.id,
          requireConfirmationForTier: ctx.behavior.requireConfirmationForTier,
          userPermissions: (ctx.userContext?.permissions ?? []) as string[],
        });

        if (result.requiresConfirmation) {
          this.setAwaiting(ctx.conversation, { actionKey: tc.name, args: tc.args });
          return { finalText: result.requiresConfirmation.message, actions, model, usage };
        }
        if (result.requiresStepUp) {
          this.setAwaiting(ctx.conversation, { actionKey: tc.name, args: tc.args });
          return {
            finalText: '',
            actions,
            model,
            usage,
            interrupt: {
              kind: 'step_up',
              text: `This is a sensitive change, so I need you to re-verify it's you first: ${result.requiresStepUp.url}`,
              url: result.requiresStepUp.url,
            },
          };
        }

        const action = this.store.getActionByKey(ctx.conversation.tenantId, tc.name);
        actions.push({
          key: tc.name,
          tier: action?.tier ?? 0,
          status: result.success ? 'succeeded' : 'blocked',
        });
        (toolResults.content as Array<{ toolCallId: string; content: unknown }>).push({
          toolCallId: tc.id,
          content: result.success ? result.data : { error: result.error ?? result.blockedReason },
        });
      }

      messages.push({ role: 'assistant', content: resp.content });
      messages.push(toolResults);
    }

    return { finalText: 'Let me get a teammate to help with this.', actions, model, usage };
  }

  // ---- awaiting (confirm / step-up resume) ----
  private async handleAwaiting(
    conversation: Conversation,
    identity: EndUserIdentity,
    session: EndUserSession,
    awaiting: AwaitingAction,
    input: InboundContext,
  ): Promise<RuntimeResult | null> {
    const text = input.text.toLowerCase().trim();
    const affirmed = AFFIRM.some((a) => text === a || text.startsWith(a + ' ') || text.includes(a));
    const denied = DENY.some((d) => text.includes(d));

    if (denied && !affirmed) {
      this.clearAwaiting(conversation);
      const reply = "No problem — I won't make that change. Anything else?";
      this.persistTurn(conversation, 'assistant', reply, input.channelType);
      return this.result(conversation, identity, [{ kind: 'text', text: reply }], []);
    }
    if (!affirmed) {
      // User changed topic — drop the pending action and fall through.
      this.clearAwaiting(conversation);
      return null;
    }

    // Re-run the locked action; pending confirmation in KV makes it execute (or step-up).
    const behavior = this.behaviorFor(
      this.store.findActivePlaybook(conversation.tenantId)!,
      conversation.currentUserState,
    );
    const result = await this.policy.executeAction({
      tenantId: conversation.tenantId,
      identity,
      session,
      actionKey: awaiting.actionKey,
      args: awaiting.args,
      conversationId: conversation.id,
      requireConfirmationForTier: behavior.requireConfirmationForTier,
      userPermissions: (identity.metadata.permissions as string[]) ?? [],
    });

    if (result.requiresStepUp) {
      const reply = `This is a sensitive change, so I need you to re-verify it's you first: ${result.requiresStepUp.url}`;
      this.persistTurn(conversation, 'assistant', reply, input.channelType);
      return this.result(
        conversation,
        identity,
        [{ kind: 'step_up', text: reply, url: result.requiresStepUp.url }],
        [],
      );
    }

    this.clearAwaiting(conversation);
    const action = this.store.getActionByKey(conversation.tenantId, awaiting.actionKey);
    let reply: string;
    if (result.success) {
      reply = action?.postActionMessage
        ? this.renderPost(action.postActionMessage, awaiting.args, result.data)
        : "Done — that's taken care of. Anything else?";
    } else {
      reply = `I couldn't complete that: ${result.error ?? result.blockedReason ?? 'unknown error'}.`;
    }
    this.persistTurn(conversation, 'assistant', reply, input.channelType, {
      actions: [{ key: awaiting.actionKey, tier: action?.tier ?? 0, status: result.success ? 'succeeded' : 'failed' }],
    });
    return this.result(
      conversation,
      identity,
      [{ kind: 'text', text: reply }],
      [{ key: awaiting.actionKey, tier: action?.tier ?? 0, status: result.success ? 'succeeded' : 'failed' }],
    );
  }

  // ---- escalation ----
  private escalate(
    conversation: Conversation,
    identity: EndUserIdentity,
    reason: string,
    priority: 'normal' | 'urgent',
    triggersFired: string[],
  ): RuntimeResult {
    conversation.status = ConversationStatus.WaitingForHuman;
    this.store.putConversation(conversation);
    this.store.putEscalation({
      id: uuid(),
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      identityId: identity.id,
      reason,
      priority,
      status: 'unassigned',
      createdAt: new Date(),
    });
    const reply = 'Of course — let me connect you with a member of the team who can help.';
    this.persistTurn(conversation, 'assistant', reply, conversation.activeChannelType);
    return {
      conversationId: conversation.id,
      identityId: identity.id,
      replies: [{ kind: 'handoff', text: reply }],
      state: conversation.currentUserState,
      stateChanged: false,
      confidence: identity.stateConfidence,
      actions: [],
      triggersFired,
      escalated: true,
      needsVerification: false,
    };
  }

  // ---- helpers ----
  private loadConversation(
    identity: EndUserIdentity,
    channelType: ChannelType,
    playbook: Playbook,
  ): Conversation {
    const existing = this.store.findActiveConversation(identity.tenantId, identity.id);
    if (existing) {
      existing.activeChannelType = channelType;
      return existing;
    }
    const now = new Date();
    const conv: Conversation = {
      id: uuid(),
      tenantId: identity.tenantId,
      identityId: identity.id,
      status: ConversationStatus.Active,
      activeChannelType: channelType,
      channelId: this.store.findChannelByType(identity.tenantId, channelType)?.id ?? 'na',
      playbookId: playbook.id,
      playbookVersion: playbook.version,
      userStateAtStart: identity.currentUserState,
      currentUserState: identity.currentUserState,
      metadata: {},
      startedAt: now,
      lastActivityAt: now,
    };
    this.store.putConversation(conv);
    return conv;
  }

  private behaviorFor(playbook: Playbook, stateKey: string): BehaviorBundle {
    const state =
      playbook.lifecycle.states.find((s) => s.key === stateKey) ??
      playbook.lifecycle.states.find((s) => s.key === playbook.lifecycle.defaultState) ??
      playbook.lifecycle.states[0]!;
    return state.behavior;
  }

  private userContext(identity: EndUserIdentity): UserContext | undefined {
    const m = identity.metadata as Record<string, unknown>;
    if (!m || Object.keys(m).length === 0) return undefined;
    return {
      externalUserId: identity.externalUserId,
      displayName: String(m.name ?? ''),
      email: String(m.email ?? ''),
      plan: m.plan ? String(m.plan) : undefined,
      accountCreatedAt: m.createdAt ? String(m.createdAt) : undefined,
      lastLoginAt: m.lastLogin ? String(m.lastLogin) : undefined,
      permissions: (m.permissions as string[]) ?? [],
      metadata: m,
    };
  }

  private persistTurn(
    conversation: Conversation,
    role: 'user' | 'assistant',
    text: string,
    channelType: ChannelType,
    meta?: Record<string, unknown>,
  ): void {
    const turn: Turn = {
      id: uuid(),
      conversationId: conversation.id,
      tenantId: conversation.tenantId,
      role,
      content: { type: 'text', text },
      channelType,
      meta,
      createdAt: new Date(),
    };
    this.store.addTurn(turn);
  }

  private setAwaiting(conversation: Conversation, awaiting: AwaitingAction): void {
    conversation.metadata.awaiting = awaiting;
    this.store.putConversation(conversation);
  }
  private clearAwaiting(conversation: Conversation): void {
    delete conversation.metadata.awaiting;
    this.store.putConversation(conversation);
  }

  private renderPost(template: string, args: Record<string, unknown>, data: unknown): string {
    const merged: Record<string, unknown> = { ...args, ...(data && typeof data === 'object' ? data : {}) };
    return template.replace(/\{(\w+)\}/g, (_, k: string) =>
      merged[k] !== undefined ? String(merged[k]) : `{${k}}`,
    );
  }

  private result(
    conversation: Conversation,
    identity: EndUserIdentity,
    replies: RuntimeReply[],
    actions: Array<{ key: string; tier: number; status: string }>,
  ): RuntimeResult {
    conversation.lastActivityAt = new Date();
    this.store.putConversation(conversation);
    return {
      conversationId: conversation.id,
      identityId: identity.id,
      replies,
      state: conversation.currentUserState,
      stateChanged: false,
      confidence: identity.stateConfidence,
      actions,
      triggersFired: [],
      escalated: false,
      needsVerification: false,
    };
  }

  private empty(state: string, replies: RuntimeReply[]): RuntimeResult {
    return {
      replies,
      state,
      stateChanged: false,
      confidence: 0,
      actions: [],
      triggersFired: [],
      escalated: false,
      needsVerification: false,
    };
  }
}
