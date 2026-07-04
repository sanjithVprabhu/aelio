import type { LLMClient } from '@aelio/types';
import type { Store } from '../store/store.js';
import type { IdentityService } from '../identity/identity-service.js';
import type { PolicyService } from '../policy/policy-service.js';
import { MemoryService } from './memory.js';
import { Telemetry } from './telemetry.js';
import type { ConvoxRegistry } from '../convox/registry.js';
import type { ConvoxPhaseState, ObjectiveStatus } from '../convox/state-engine.js';
import type { ActiveIntent } from './intent-engine.js';
import type { HarnessTrace } from './harness.js';
import type { TurnInsight } from './turn-insight.js';
import { TurnHarness } from './turn-harness.js';
import type { FlowDefinition } from '../flows/flow-engine.js';
import { DEMO_FLOWS } from '../flows/demo-flows.js';

export type { ConvoxPhaseState, ObjectiveStatus };

export interface InboundContext {
  tenantId: string;
  channelType: import('@aelio/types').ChannelType;
  identifier: string;
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
  /** Active Convox phase + guided objective progress (when states are registered). */
  convoxPhase?: ConvoxPhaseState;
  objectives?: ObjectiveStatus[];
  activeIntent?: ActiveIntent | null;
  harness?: HarnessTrace;
  /** Product telemetry for this turn — message, intent, state, flow, tools. */
  turnInsight?: TurnInsight;
}

export interface AgentRuntimeLlmOptions {
  resolveLlm?: LLMClient;
  synthesizeLlm?: LLMClient;
}

/**
 * Agent runtime — identity → memory → curated Convox tools → LLM tool loop → reply.
 */
export class AgentRuntime {
  private readonly harness: TurnHarness;

  constructor(
    private readonly store: Store,
    identity: IdentityService,
    policy: PolicyService,
    llm: LLMClient,
    memory: MemoryService,
    telemetry: Telemetry,
    convox: ConvoxRegistry,
    kv: import('../store/kv.js').Kv,
    onPhaseChange?: (input: {
      tenantId: string;
      identityId: string;
      phase: ConvoxPhaseState;
    }) => void,
    llmOptions?: AgentRuntimeLlmOptions,
    flows: FlowDefinition[] = DEMO_FLOWS,
  ) {
    const resolveLlm = llmOptions?.resolveLlm ?? llm;
    const synthesizeLlm = llmOptions?.synthesizeLlm ?? llm;
    this.harness = new TurnHarness(
      store,
      identity,
      policy,
      resolveLlm,
      synthesizeLlm,
      memory,
      telemetry,
      convox,
      kv,
      flows,
      onPhaseChange,
    );
  }

  async handleInbound(input: InboundContext): Promise<RuntimeResult> {
    const tenant = this.store.getTenant(input.tenantId);
    if (!tenant) {
      return {
        replies: [{ kind: 'text', text: 'Unknown tenant.' }],
        state: 'active',
        stateChanged: false,
        confidence: 0,
        actions: [],
        triggersFired: [],
        escalated: false,
        needsVerification: false,
      };
    }
    return this.harness.run(input);
  }
}