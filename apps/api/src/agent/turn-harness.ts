import { createLogger } from '@aelio/logger';
import {
  type ActionDefinition,
  ChannelType,
  ConversationStatus,
  type Conversation,
  type EndUserIdentity,
  type EndUserSession,
  type LLMClient,
  type LLMMessage,
  type Turn,
  type UserContext,
} from '@aelio/types';
import type { Store } from '../store/store.js';
import type { IdentityService } from '../identity/identity-service.js';
import type { PolicyService } from '../policy/policy-service.js';
import { MemoryService } from './memory.js';
import { Telemetry } from './telemetry.js';
import { buildAgentContext, toolsFromActions } from './context-builder.js';
import { advance, createHarnessTrace, type HarnessTrace } from './harness.js';
import {
  buildIntentGuidanceBlock,
  clearActiveIntent,
  readActiveIntent,
  resolveActiveIntent,
  type ActiveIntent,
} from './intent-engine.js';
import { CONVOX_PLAYBOOK_ID } from '../convox/bridge.js';
import type { ConvoxRegistry } from '../convox/registry.js';
import {
  applyToolObjectiveCompletion,
  buildObjectiveStatus,
  buildStateGuidanceBlock,
  filterActionsForState,
  findStateManifest,
  inferConvoxPhase,
  readConvoxPhase,
  writeConvoxPhase,
  type ConvoxPhaseState,
  type ObjectiveStatus,
} from '../convox/state-engine.js';
import {
  buildEnvSnapshotBlock,
  getEnvSnapshot,
  putEnvSnapshot,
  type EnvSnapshot,
} from './env-snapshot.js';
import {
  buildFlowGuidanceBlock,
  resolveActiveFlow,
  type FlowDefinition,
} from '../flows/flow-engine.js';
import { buildTurnInsight } from './turn-insight.js';
import { formatToolResultForUser } from './format-tool-result.js';
import type { Kv } from '../store/kv.js';
import { uuid } from '../util/id.js';
import type { InboundContext, RuntimeReply, RuntimeResult } from './runtime.js';

const MAX_TOOL_ITERATIONS = 5;
const REQUIRE_CONFIRMATION_TIER = 1;
const ENV_SNAPSHOT_TOOLS = new Set(['get_account_status', 'get_invoice']);
const AFFIRM = [
  'yes',
  'confirm',
  'go ahead',
  'do it',
  'ok',
  'okay',
  'sure',
  'yep',
  'proceed',
  'confirmed',
  'please do',
  'done',
];
const DENY = ['no', "don't", 'stop', 'cancel that', 'nevermind', 'never mind'];

interface AwaitingAction {
  actionKey: string;
  args: Record<string, unknown>;
}

interface ToolLoopResult {
  finalText: string;
  actions: Array<{ key: string; tier: number; status: string }>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  hadToolExecutions: boolean;
  toolResultsSummary: string;
  lastToolPayload?: unknown;
  interrupt?: { kind: 'step_up'; text: string; url?: string };
  requiresConfirmation?: { message: string };
}

/**
 * Rigid turn harness — RESOLVE → ROUTE → COLLECT? → PLAN → VALIDATE → CONFIRM? → EXECUTE → SYNTHESIZE.
 */
export class TurnHarness {
  constructor(
    private readonly store: Store,
    private readonly identity: IdentityService,
    private readonly policy: PolicyService,
    private readonly resolveLlm: LLMClient,
    private readonly synthesizeLlm: LLMClient,
    private readonly memory: MemoryService,
    private readonly telemetry: Telemetry,
    private readonly convox: ConvoxRegistry,
    private readonly kv: Kv,
    private readonly flows: FlowDefinition[],
    private readonly onPhaseChange?: (input: {
      tenantId: string;
      identityId: string;
      phase: ConvoxPhaseState;
    }) => void,
  ) {}

  async run(input: InboundContext): Promise<RuntimeResult> {
    const tenant = this.store.getTenant(input.tenantId);
    if (!tenant) {
      return this.empty('active', [{ kind: 'text', text: 'Unknown tenant.' }]);
    }
    const log = createLogger({ tenantId: input.tenantId, channelType: input.channelType });

    const resolved = await this.identity.resolveOrInitiate(
      input.tenantId,
      input.channelType,
      input.identifier,
    );
    if (resolved.status === 'needs_verification') {
      const replies: RuntimeReply[] = [
        {
          kind: 'magic_link',
          text: `Before I can help with your account, please verify it's you: ${resolved.magicLinkUrl}`,
          url: resolved.magicLinkUrl,
        },
      ];
      return this.withInsight(
        {
          ...this.empty('active', replies),
          identityId: resolved.identity.id,
          needsVerification: true,
        },
        {
          tenantId: input.tenantId,
          tenantSlug: tenant.slug,
          identityId: resolved.identity.id,
          identifier: input.identifier,
          message: input.text,
          channel: input.channelType,
          harness: { phases: ['RESOLVE'] },
        },
      );
    }

    const startedAt = Date.now();
    const identity = resolved.identity;
    const session = resolved.session;
    const userContext = this.userContext(identity);
    const conversation = this.loadConversation(identity, input.channelType);
    const log2 = log.child({ conversationId: conversation.id, identityId: identity.id });

    const userTurn = this.persistTurn(conversation, 'user', input.text, input.channelType);
    this.memory.indexTurn({ turn: userTurn, identityId: identity.id, text: input.text });

    const awaiting = conversation.metadata.awaiting as AwaitingAction | undefined;
    if (awaiting) {
      const handled = await this.handleAwaiting(conversation, identity, session, awaiting, input);
      if (handled) {
        const phase = readConvoxPhase(conversation.metadata);
        const states = this.convox.listStates(input.tenantId);
        const manifest = findStateManifest(states, phase?.currentState ?? handled.state);
        return this.withInsight(handled, {
          tenantId: input.tenantId,
          tenantSlug: tenant.slug,
          conversationId: conversation.id,
          identityId: identity.id,
          identifier: input.identifier,
          message: input.text,
          channel: input.channelType,
          phase: phase ?? undefined,
          stateManifest: manifest,
          harness: { phases: ['RESOLVE', 'CONFIRM', 'EXECUTE', 'SYNTHESIZE'] },
          awaitingConfirmation: true,
        });
      }
    }

    const exposed = this.store.listExposedActions(input.tenantId);
    const facts = this.memory
      .facts(input.tenantId, identity.id)
      .map((f) => ({ key: f.key, value: f.value }));

    const historyResult = await this.memory.buildConversationHistory({
      tenantId: input.tenantId,
      identityId: identity.id,
      conversationId: conversation.id,
      queryText: input.text,
    });

    const harness = createHarnessTrace();
    advance(harness, 'RESOLVE');

    const priorIntent = await readActiveIntent(this.kv, input.tenantId, identity.id);
    const intentResult = await resolveActiveIntent({
      kv: this.kv,
      llm: this.resolveLlm,
      tenantId: input.tenantId,
      identityId: identity.id,
      conversationId: conversation.id,
      message: input.text,
      actions: exposed,
      prior: priorIntent,
    });
    advance(harness, 'ROUTE');

    if (intentResult.aborted && priorIntent) {
      this.memory.indexIntentEpisode({
        tenantId: input.tenantId,
        identityId: identity.id,
        conversationId: conversation.id,
        intentKey: priorIntent.intentKey,
        phase: conversation.currentUserState,
        body: `${input.text}\n→ (aborted)`,
        startedAt: new Date(priorIntent.startedAt),
        endedAt: new Date(),
      });
    }

    const convoxStates = this.convox.listStates(input.tenantId);
    const priorPhase = readConvoxPhase(conversation.metadata);
    let phase = await inferConvoxPhase({
      llm: this.resolveLlm,
      tenantId: input.tenantId,
      conversationId: conversation.id,
      states: convoxStates,
      history: historyResult.turns,
      currentMessage: input.text,
      prior: priorPhase,
    });
    const stateManifest = findStateManifest(convoxStates, phase.currentState);
    const stateChanged = priorPhase?.currentState !== phase.currentState;
    if (stateChanged && this.onPhaseChange) {
      this.onPhaseChange({ tenantId: input.tenantId, identityId: identity.id, phase });
    }
    const filteredActions = this.actionsForTurn(exposed, stateManifest, intentResult.intent);
    const tools = toolsFromActions(filteredActions);

    const envSnapshots = await this.loadEnvSnapshots(input.tenantId, identity.id);
    const envSnapshotBlock = buildEnvSnapshotBlock(envSnapshots);
    const flowGuidanceBlock = this.buildFlowGuidance(stateManifest, phase);

    if (intentResult.intent && intentResult.intent.missingSlots.length > 0) {
      advance(harness, 'COLLECT');
      const collectCtx = this.buildContext({
        tenantName: tenant.name,
        userContext,
        history: historyResult.turns,
        currentMessage: input.text,
        tools: [],
        facts,
        stateManifest,
        phase,
        convoxStates,
        intent: intentResult.intent,
        aborted: intentResult.aborted,
        envSnapshotBlock,
        flowGuidanceBlock,
      });

      const collectResp = await this.synthesizeLlm.complete({
        messages: collectCtx.messages,
        systemPrompt: collectCtx.systemPrompt,
        tenantId: input.tenantId,
        conversationId: conversation.id,
      });

      conversation.metadata = {
        ...writeConvoxPhase(conversation.metadata, phase),
        harness: harness.phases,
        activeIntent: intentResult.intent,
      };
      conversation.currentUserState = phase.currentState;

      const replyText =
        collectResp.content.trim() ||
        `Could you share your ${intentResult.intent.missingSlots[0]}?`;
      const replies: RuntimeReply[] = [{ kind: 'text', text: replyText }];

      const assistantTurn = this.persistTurn(conversation, 'assistant', replyText, input.channelType, {
        model: collectResp.model,
      });
      this.memory.indexTurn({
        turn: assistantTurn,
        identityId: identity.id,
        text: replyText,
      });
      conversation.lastActivityAt = new Date();
      this.store.putConversation(conversation);

      this.emitTelemetry({
        input,
        conversation,
        identity,
        phase,
        stateChanged,
        model: collectResp.model,
        usage: { inputTokens: collectResp.inputTokens, outputTokens: collectResp.outputTokens },
        actions: [],
        memoryHits: historyResult.memoryHits,
        startedAt,
        channelType: input.channelType,
      });
      void log2;

      return this.withInsight(
        {
          conversationId: conversation.id,
          identityId: identity.id,
          replies,
          state: phase.currentState,
          stateChanged,
          confidence: phase.confidence,
          actions: [],
          triggersFired: [],
          escalated: false,
          needsVerification: false,
          convoxPhase: convoxStates.length > 0 ? phase : undefined,
          objectives:
            convoxStates.length > 0 ? buildObjectiveStatus(stateManifest, phase) : undefined,
          activeIntent: intentResult.intent,
          harness,
        },
        {
          tenantId: input.tenantId,
          tenantSlug: tenant.slug,
          conversationId: conversation.id,
          identityId: identity.id,
          identifier: input.identifier,
          message: input.text,
          channel: input.channelType,
          startedAt,
          priorState: priorPhase?.currentState ?? null,
          phase,
          stateManifest,
          intent: intentResult.intent,
          intentAborted: intentResult.aborted,
          model: collectResp.model,
        },
      );
    }

    advance(harness, 'PLAN');
    advance(harness, 'VALIDATE');

    const ctx = this.buildContext({
      tenantName: tenant.name,
      userContext,
      history: historyResult.turns,
      currentMessage: input.text,
      tools,
      facts,
      stateManifest,
      phase,
      convoxStates,
      intent: intentResult.intent,
      aborted: intentResult.aborted,
      envSnapshotBlock,
      flowGuidanceBlock,
    });

    const allowedKeys = new Set(filteredActions.map((a) => a.key));
    const loop =
      (await this.tryIntentDispatch(intentResult.intent, allowedKeys, {
        conversation,
        identity,
        session,
        userContext,
      })) ??
      (await this.toolLoop(ctx.systemPrompt, ctx.messages, ctx.tools, {
        conversation,
        identity,
        session,
        userContext,
      }));

    if (loop.requiresConfirmation) {
      advance(harness, 'CONFIRM');
      const confirmText = loop.requiresConfirmation.message;
      conversation.metadata = {
        ...writeConvoxPhase(conversation.metadata, phase),
        harness: harness.phases,
        activeIntent: intentResult.intent,
      };
      conversation.currentUserState = phase.currentState;

      const replies: RuntimeReply[] = [{ kind: 'text', text: confirmText }];
      const assistantTurn = this.persistTurn(conversation, 'assistant', confirmText, input.channelType, {
        model: loop.model,
        actions: loop.actions,
      });
      this.memory.indexTurn({ turn: assistantTurn, identityId: identity.id, text: confirmText });
      conversation.lastActivityAt = new Date();
      this.store.putConversation(conversation);

      this.emitTelemetry({
        input,
        conversation,
        identity,
        phase,
        stateChanged,
        model: loop.model,
        usage: loop.usage,
        actions: loop.actions,
        memoryHits: historyResult.memoryHits,
        startedAt,
        channelType: input.channelType,
      });
      void log2;

      return this.withInsight(
        {
          conversationId: conversation.id,
          identityId: identity.id,
          replies,
          state: phase.currentState,
          stateChanged,
          confidence: phase.confidence,
          actions: loop.actions,
          triggersFired: [],
          escalated: false,
          needsVerification: false,
          convoxPhase: convoxStates.length > 0 ? phase : undefined,
          objectives:
            convoxStates.length > 0 ? buildObjectiveStatus(stateManifest, phase) : undefined,
          activeIntent: intentResult.intent,
          harness,
        },
        {
          tenantId: input.tenantId,
          tenantSlug: tenant.slug,
          conversationId: conversation.id,
          identityId: identity.id,
          identifier: input.identifier,
          message: input.text,
          channel: input.channelType,
          startedAt,
          priorState: priorPhase?.currentState ?? null,
          phase,
          stateManifest,
          intent: intentResult.intent,
          intentAborted: intentResult.aborted,
          model: loop.model,
          awaitingConfirmation: true,
        },
      );
    }

    if (loop.actions.some((a) => a.status === 'succeeded')) advance(harness, 'EXECUTE');
    advance(harness, 'SYNTHESIZE');

    let finalText = loop.finalText;
    let synthModel = loop.model;
    let synthUsage = { inputTokens: 0, outputTokens: 0 };

    if (loop.hadToolExecutions) {
      const dispatchedKey = intentResult.intent?.intentKey;
      const quickReply =
        dispatchedKey && loop.lastToolPayload !== undefined
          ? formatToolResultForUser(dispatchedKey, loop.lastToolPayload)
          : undefined;

      if (quickReply) {
        finalText = quickReply;
        synthModel = loop.model;
      } else {
        const synthSystem = [
          ctx.systemPrompt,
          '',
          '## Tool results (summarize for the user)',
          loop.toolResultsSummary || '(no tool output)',
          '',
          'Write a concise, helpful reply based on the tool results. Do not invent data.',
        ].join('\n');

        const synthMessages = this.messagesWithToolPayload(
          ctx.messages,
          loop.lastToolPayload,
          loop.toolResultsSummary,
        );

        const synthResp = await this.synthesizeLlm.complete({
          messages: synthMessages,
          systemPrompt: synthSystem,
          tenantId: input.tenantId,
          conversationId: conversation.id,
        });
        finalText = synthResp.content.trim() || loop.finalText;
        synthModel = synthResp.model;
        synthUsage = { inputTokens: synthResp.inputTokens, outputTokens: synthResp.outputTokens };
      }
    }

    phase = this.applyToolCompletions(phase, stateManifest, loop.actions);
    conversation.metadata = {
      ...writeConvoxPhase(conversation.metadata, phase),
      harness: harness.phases,
      activeIntent: intentResult.intent,
    };
    conversation.currentUserState = phase.currentState;

    const replies: RuntimeReply[] = [];
    if (loop.interrupt?.kind === 'step_up') {
      replies.push({ kind: 'step_up', text: loop.interrupt.text, url: loop.interrupt.url });
    } else {
      replies.push({
        kind: 'text',
        text: finalText || "I'm not sure how to help with that yet.",
      });
    }

    if (intentResult.intent && intentResult.intent.missingSlots.length === 0 && loop.actions.length > 0) {
      this.memory.indexIntentEpisode({
        tenantId: input.tenantId,
        identityId: identity.id,
        conversationId: conversation.id,
        intentKey: intentResult.intent.intentKey,
        phase: phase.currentState,
        body: `${input.text}\n→ ${replies[0]!.text}`,
        startedAt: new Date(intentResult.intent.startedAt),
        endedAt: new Date(),
      });
      await clearActiveIntent(this.kv, input.tenantId, identity.id);
      intentResult.intent = null;
    }

    const totalUsage = {
      inputTokens: loop.usage.inputTokens + synthUsage.inputTokens,
      outputTokens: loop.usage.outputTokens + synthUsage.outputTokens,
    };

    const assistantTurn = this.persistTurn(conversation, 'assistant', replies[0]!.text, input.channelType, {
      model: synthModel,
      actions: loop.actions,
    });
    this.memory.indexTurn({
      turn: assistantTurn,
      identityId: identity.id,
      text: replies[0]!.text,
    });
    conversation.lastActivityAt = new Date();
    this.store.putConversation(conversation);

    this.emitTelemetry({
      input,
      conversation,
      identity,
      phase,
      stateChanged,
      model: synthModel,
      usage: totalUsage,
      actions: loop.actions,
      memoryHits: historyResult.memoryHits,
      startedAt,
      channelType: input.channelType,
    });
    void log2;

    return this.withInsight(
      {
        conversationId: conversation.id,
        identityId: identity.id,
        replies,
        state: phase.currentState,
        stateChanged,
        confidence: phase.confidence,
        actions: loop.actions,
        triggersFired: [],
        escalated: false,
        needsVerification: false,
        convoxPhase: convoxStates.length > 0 ? phase : undefined,
        objectives:
          convoxStates.length > 0 ? buildObjectiveStatus(stateManifest, phase) : undefined,
        activeIntent: intentResult.intent,
        harness,
      },
      {
        tenantId: input.tenantId,
        tenantSlug: tenant.slug,
        conversationId: conversation.id,
        identityId: identity.id,
        identifier: input.identifier,
        message: input.text,
        channel: input.channelType,
        startedAt,
        priorState: priorPhase?.currentState ?? null,
        phase,
        stateManifest,
        intent: intentResult.intent,
        intentAborted: intentResult.aborted,
        model: synthModel,
        stepUpRequired: loop.interrupt?.kind === 'step_up',
      },
    );
  }

  private withInsight(
    result: RuntimeResult,
    input: {
      tenantId: string;
      tenantSlug?: string;
      conversationId?: string;
      identityId?: string;
      identifier?: string;
      message: string;
      channel: string;
      startedAt?: number;
      priorState?: string | null;
      phase?: ConvoxPhaseState;
      stateManifest?: ReturnType<typeof findStateManifest>;
      intent?: ActiveIntent | null;
      intentAborted?: boolean;
      harness?: { phases: import('./harness.js').HarnessPhase[] };
      model?: string;
      awaitingConfirmation?: boolean;
      stepUpRequired?: boolean;
    },
  ): RuntimeResult {
    const stepUp =
      input.stepUpRequired ?? result.replies.some((r) => r.kind === 'step_up');
    const confirm =
      input.awaitingConfirmation ?? result.harness?.phases.includes('CONFIRM') ?? false;
    return {
      ...result,
      turnInsight: buildTurnInsight({
        tenantId: input.tenantId,
        tenantSlug: input.tenantSlug,
        conversationId: result.conversationId ?? input.conversationId,
        identityId: result.identityId ?? input.identityId,
        identifier: input.identifier,
        message: input.message,
        channel: input.channel,
        replies: result.replies,
        harness: result.harness ?? input.harness,
        intent: result.activeIntent ?? input.intent,
        intentAborted: input.intentAborted,
        phase: result.convoxPhase ?? input.phase,
        priorState: input.priorState,
        stateChanged: result.stateChanged,
        flows: this.flows,
        stateManifest: input.stateManifest,
        actions: result.actions,
        objectives: result.objectives,
        model: input.model,
        latencyMs: input.startedAt ? Date.now() - input.startedAt : undefined,
        needsVerification: result.needsVerification,
        awaitingConfirmation: confirm,
        stepUpRequired: stepUp,
      }),
    };
  }

  private buildContext(input: {
    tenantName: string;
    userContext?: UserContext;
    history: Turn[];
    currentMessage: string;
    tools: ReturnType<typeof toolsFromActions>;
    facts: Array<{ key: string; value: unknown }>;
    stateManifest: ReturnType<typeof findStateManifest>;
    phase: ConvoxPhaseState;
    convoxStates: ReturnType<ConvoxRegistry['listStates']>;
    intent: ActiveIntent | null;
    aborted: boolean;
    envSnapshotBlock?: string;
    flowGuidanceBlock?: string;
  }): ReturnType<typeof buildAgentContext> {
    const ctx = buildAgentContext({
      tenantName: input.tenantName,
      userContext: input.userContext,
      history: input.history,
      currentMessage: input.currentMessage,
      tools: input.tools,
      facts: input.facts,
      stateGuidanceBlock:
        input.convoxStates.length > 0
          ? buildStateGuidanceBlock(input.stateManifest, input.phase)
          : undefined,
      intentGuidanceBlock: buildIntentGuidanceBlock(input.intent, input.aborted),
    });
    let systemPrompt = ctx.systemPrompt;
    if (input.envSnapshotBlock?.trim()) systemPrompt += input.envSnapshotBlock;
    if (input.flowGuidanceBlock?.trim()) systemPrompt += input.flowGuidanceBlock;
    return { ...ctx, systemPrompt };
  }

  private messagesWithToolPayload(
    messages: LLMMessage[],
    payload: unknown | undefined,
    summary: string,
  ): LLMMessage[] {
    if (payload !== undefined) {
      return [
        ...messages,
        { role: 'tool', content: [{ toolCallId: 'synth_0', content: payload }] },
      ];
    }
    return this.messagesWithToolSummary(messages, summary);
  }

  private messagesWithToolSummary(messages: LLMMessage[], summary: string): LLMMessage[] {
    if (!summary.trim()) return messages;
    const toolContent = summary
      .split('\n')
      .filter(Boolean)
      .map((line, i) => {
        const sep = line.indexOf(': ');
        let payload: unknown = line;
        if (sep >= 0) {
          const raw = line.slice(sep + 2);
          try {
            payload = JSON.parse(raw) as unknown;
          } catch {
            payload = raw;
          }
        }
        return { toolCallId: `synth_${i}`, content: payload };
      });
    if (!toolContent.length) return messages;
    return [...messages, { role: 'tool', content: toolContent }];
  }

  private buildFlowGuidance(
    stateManifest: ReturnType<typeof findStateManifest>,
    phase: ConvoxPhaseState,
  ): string | undefined {
    const resolved = resolveActiveFlow(
      this.flows,
      phase.currentState,
      phase.completedObjectives,
      stateManifest?.objectives,
    );
    if (!resolved) return undefined;
    return buildFlowGuidanceBlock(resolved.flow, resolved.step);
  }

  private async loadEnvSnapshots(tenantId: string, identityId: string): Promise<EnvSnapshot[]> {
    const keys = [...ENV_SNAPSHOT_TOOLS];
    const snaps = await Promise.all(
      keys.map((toolKey) => getEnvSnapshot(this.kv, tenantId, identityId, toolKey)),
    );
    return snaps.filter((s): s is EnvSnapshot => s !== null);
  }

  /**
   * State guidance narrows the catalog, but a resolved user intent should still
   * keep its matching tool available for the current turn.
   */
  private actionsForTurn(
    exposed: ActionDefinition[],
    stateManifest: ReturnType<typeof findStateManifest>,
    intent: ActiveIntent | null,
  ): ActionDefinition[] {
    const filtered = filterActionsForState(exposed, stateManifest);
    if (!intent) return filtered;
    if (filtered.some((action) => action.key === intent.intentKey)) return filtered;
    const resolved = exposed.find((action) => action.key === intent.intentKey);
    return resolved ? [...filtered, resolved] : filtered;
  }

  /** Run a resolved intent directly when slots are full (bypasses LLM tool-calling). */
  private async tryIntentDispatch(
    intent: ActiveIntent | null,
    allowedKeys: Set<string>,
    ctx: {
      conversation: Conversation;
      identity: EndUserIdentity;
      session: EndUserSession;
      userContext?: UserContext;
    },
  ): Promise<ToolLoopResult | null> {
    if (!intent || intent.missingSlots.length > 0) return null;
    if (!allowedKeys.has(intent.intentKey)) return null;

    const result = await this.policy.executeAction({
      tenantId: ctx.conversation.tenantId,
      identity: ctx.identity,
      session: ctx.session,
      actionKey: intent.intentKey,
      args: intent.args,
      conversationId: ctx.conversation.id,
      requireConfirmationForTier: REQUIRE_CONFIRMATION_TIER,
      userPermissions: (ctx.userContext?.permissions ?? []) as string[],
    });

    const action = this.store.getActionByKey(ctx.conversation.tenantId, intent.intentKey);
    const tier = action?.tier ?? 0;
    const actions: Array<{ key: string; tier: number; status: string }> = [];

    if (result.requiresConfirmation) {
      this.setAwaiting(ctx.conversation, { actionKey: intent.intentKey, args: intent.args });
      return {
        finalText: result.requiresConfirmation.message,
        actions,
        model: 'intent-dispatch',
        usage: { inputTokens: 0, outputTokens: 0 },
        hadToolExecutions: false,
        toolResultsSummary: '',
        requiresConfirmation: result.requiresConfirmation,
      };
    }
    if (result.requiresStepUp) {
      this.setAwaiting(ctx.conversation, { actionKey: intent.intentKey, args: intent.args });
      return {
        finalText: '',
        actions,
        model: 'intent-dispatch',
        usage: { inputTokens: 0, outputTokens: 0 },
        hadToolExecutions: false,
        toolResultsSummary: '',
        interrupt: {
          kind: 'step_up',
          text: `This is a sensitive change, so I need you to re-verify it's you first: ${result.requiresStepUp.url}`,
          url: result.requiresStepUp.url,
        },
      };
    }

    const status = result.success ? 'succeeded' : 'blocked';
    actions.push({ key: intent.intentKey, tier, status });
    const payload = result.success ? result.data : { error: result.error ?? result.blockedReason };
    if (result.success && tier === 0 && ENV_SNAPSHOT_TOOLS.has(intent.intentKey)) {
      await putEnvSnapshot(
        this.kv,
        ctx.conversation.tenantId,
        ctx.identity.id,
        intent.intentKey,
        result.data,
      );
    }

    return {
      finalText: '',
      actions,
      model: 'intent-dispatch',
      usage: { inputTokens: 0, outputTokens: 0 },
      hadToolExecutions: result.success,
      toolResultsSummary: `${intent.intentKey} (${status}): ${JSON.stringify(payload)}`,
      lastToolPayload: result.success ? result.data : undefined,
    };
  }

  private async toolLoop(
    systemPrompt: string,
    initialMessages: LLMMessage[],
    tools: ReturnType<typeof toolsFromActions>,
    ctx: {
      conversation: Conversation;
      identity: EndUserIdentity;
      session: EndUserSession;
      userContext?: UserContext;
    },
  ): Promise<ToolLoopResult> {
    const messages = [...initialMessages];
    const actions: Array<{ key: string; tier: number; status: string }> = [];
    let model = 'scripted';
    const usage = { inputTokens: 0, outputTokens: 0 };
    let hadToolExecutions = false;
    const summaryLines: string[] = [];
    let pendingFinalText = '';
    let lastToolPayload: unknown;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const resp = await this.resolveLlm.complete({
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
        pendingFinalText = resp.content;
        break;
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
          requireConfirmationForTier: REQUIRE_CONFIRMATION_TIER,
          userPermissions: (ctx.userContext?.permissions ?? []) as string[],
        });

        if (result.requiresConfirmation) {
          this.setAwaiting(ctx.conversation, { actionKey: tc.name, args: tc.args });
          return {
            finalText: result.requiresConfirmation.message,
            actions,
            model,
            usage,
            hadToolExecutions,
            toolResultsSummary: summaryLines.join('\n'),
            requiresConfirmation: result.requiresConfirmation,
          };
        }
        if (result.requiresStepUp) {
          this.setAwaiting(ctx.conversation, { actionKey: tc.name, args: tc.args });
          return {
            finalText: '',
            actions,
            model,
            usage,
            hadToolExecutions,
            toolResultsSummary: summaryLines.join('\n'),
            interrupt: {
              kind: 'step_up',
              text: `This is a sensitive change, so I need you to re-verify it's you first: ${result.requiresStepUp.url}`,
              url: result.requiresStepUp.url,
            },
          };
        }

        const action = this.store.getActionByKey(ctx.conversation.tenantId, tc.name);
        const tier = action?.tier ?? 0;
        const status = result.success ? 'succeeded' : 'blocked';
        actions.push({ key: tc.name, tier, status });
        hadToolExecutions = true;

        if (result.success && tier === 0 && ENV_SNAPSHOT_TOOLS.has(tc.name)) {
          await putEnvSnapshot(
            this.kv,
            ctx.conversation.tenantId,
            ctx.identity.id,
            tc.name,
            result.data,
          );
        }

        const payload = result.success ? result.data : { error: result.error ?? result.blockedReason };
        summaryLines.push(`${tc.name} (${status}): ${JSON.stringify(payload)}`);
        if (result.success) lastToolPayload = payload;
        (toolResults.content as Array<{ toolCallId: string; content: unknown }>).push({
          toolCallId: tc.id,
          content: payload,
        });
      }

      messages.push({
        role: 'assistant',
        content: resp.content,
        toolCalls: resp.toolCalls,
      });
      messages.push(toolResults);
    }

    return {
      finalText: pendingFinalText || 'Let me get a teammate to help with this.',
      actions,
      model,
      usage,
      hadToolExecutions,
      toolResultsSummary: summaryLines.join('\n'),
      lastToolPayload,
    };
  }

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
      this.clearAwaiting(conversation);
      return null;
    }

    const result = await this.policy.executeAction({
      tenantId: conversation.tenantId,
      identity,
      session,
      actionKey: awaiting.actionKey,
      args: awaiting.args,
      conversationId: conversation.id,
      requireConfirmationForTier: REQUIRE_CONFIRMATION_TIER,
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
    const actions = [
      {
        key: awaiting.actionKey,
        tier: action?.tier ?? 0,
        status: result.success ? 'succeeded' : 'failed',
      },
    ];
    this.persistTurn(conversation, 'assistant', reply, input.channelType, { actions });
    return this.resultWithPhase(conversation, identity, [{ kind: 'text', text: reply }], actions);
  }

  private loadConversation(identity: EndUserIdentity, channelType: ChannelType): Conversation {
    const existing = this.store.findActiveConversation(identity.tenantId, identity.id);
    if (existing) {
      existing.activeChannelType = channelType;
      return existing;
    }
    const defaultState = this.convox.listStates(identity.tenantId)[0]?.key ?? 'active';
    const now = new Date();
    const conv: Conversation = {
      id: uuid(),
      tenantId: identity.tenantId,
      identityId: identity.id,
      status: ConversationStatus.Active,
      activeChannelType: channelType,
      channelId:
        this.store.findChannelByType(identity.tenantId, channelType)?.id ??
        '00000000-0000-4000-8000-0000000000c2',
      playbookId: CONVOX_PLAYBOOK_ID,
      playbookVersion: '1',
      userStateAtStart: identity.currentUserState,
      currentUserState: defaultState,
      metadata: {},
      startedAt: now,
      lastActivityAt: now,
    };
    this.store.putConversation(conv);
    return conv;
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
  ): Turn {
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
    return turn;
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
    const merged: Record<string, unknown> = {
      ...args,
      ...(data && typeof data === 'object' ? data : {}),
    };
    return template.replace(/\{(\w+)\}/g, (_, k: string) =>
      merged[k] !== undefined ? String(merged[k]) : `{${k}}`,
    );
  }

  private applyToolCompletions(
    phase: ConvoxPhaseState,
    manifest: ReturnType<typeof findStateManifest>,
    actions: Array<{ key: string; tier: number; status: string }>,
  ): ConvoxPhaseState {
    const succeeded = actions.filter((a) => a.status === 'succeeded').map((a) => a.key);
    return {
      ...phase,
      completedObjectives: applyToolObjectiveCompletion(manifest, phase.completedObjectives, succeeded),
    };
  }

  private emitTelemetry(input: {
    input: InboundContext;
    conversation: Conversation;
    identity: EndUserIdentity;
    phase: ConvoxPhaseState;
    stateChanged: boolean;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
    actions: Array<{ key: string; tier: number; status: string }>;
    memoryHits: number;
    startedAt: number;
    channelType: ChannelType;
  }): void {
    this.telemetry.emit({
      eventType: 'turn.completed',
      tenantId: input.input.tenantId,
      conversationId: input.conversation.id,
      identityId: input.identity.id,
      playbookVersion: 'convox',
      userState: input.phase.currentState,
      stateChanged: input.stateChanged,
      model: input.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      llmLatencyMs: 0,
      toolCallCount: input.actions.length,
      toolCallResults: input.actions.map((a) => ({
        actionKey: a.key,
        success: a.status === 'succeeded',
        tier: a.tier,
      })),
      kbChunksRetrieved: input.memoryHits,
      fallbackTriggered: false,
      triggersFired: [],
      escalated: false,
      channelType: input.channelType,
      totalLatencyMs: Date.now() - input.startedAt,
      playbookIsExperiment: false,
    });
  }

  private resultWithPhase(
    conversation: Conversation,
    identity: EndUserIdentity,
    replies: RuntimeReply[],
    actions: Array<{ key: string; tier: number; status: string }>,
  ): RuntimeResult {
    const states = this.convox.listStates(conversation.tenantId);
    const prior = readConvoxPhase(conversation.metadata);
    const manifest = findStateManifest(states, prior?.currentState ?? 'active');
    let phase = prior ?? {
      currentState: manifest?.key ?? 'active',
      confidence: 0.5,
      completedObjectives: [] as string[],
    };
    phase = this.applyToolCompletions(phase, manifest, actions);
    conversation.metadata = writeConvoxPhase(conversation.metadata, phase);
    conversation.currentUserState = phase.currentState;
    conversation.lastActivityAt = new Date();
    this.store.putConversation(conversation);
    return {
      conversationId: conversation.id,
      identityId: identity.id,
      replies,
      state: phase.currentState,
      stateChanged: false,
      confidence: phase.confidence,
      actions,
      triggersFired: [],
      escalated: false,
      needsVerification: false,
    };
  }

  private result(
    conversation: Conversation,
    identity: EndUserIdentity,
    replies: RuntimeReply[],
    actions: Array<{ key: string; tier: number; status: string }>,
  ): RuntimeResult {
    conversation.lastActivityAt = new Date();
    this.store.putConversation(conversation);
    const phase = readConvoxPhase(conversation.metadata);
    return {
      conversationId: conversation.id,
      identityId: identity.id,
      replies,
      state: phase?.currentState ?? conversation.currentUserState,
      stateChanged: false,
      confidence: phase?.confidence ?? identity.stateConfidence,
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

export type { HarnessTrace, ObjectiveStatus, ConvoxPhaseState };
