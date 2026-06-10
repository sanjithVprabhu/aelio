import { createLogger } from '@aelio/logger';
import type { Store } from '../store/store.js';
import { ulid } from '../util/id.js';

/** Per-turn telemetry event (manual §6 Telemetry). Emitted on every completed turn. */
export interface TurnTelemetryEvent {
  eventType: 'turn.completed';
  tenantId: string;
  conversationId: string;
  identityId: string;
  playbookVersion: string;
  userState: string;
  stateChanged: boolean;
  model: string;
  inputTokens: number;
  outputTokens: number;
  llmLatencyMs: number;
  toolCallCount: number;
  toolCallResults: Array<{ actionKey: string; success: boolean; tier: number }>;
  kbChunksRetrieved: number;
  fallbackTriggered: boolean;
  triggersFired: string[];
  escalated: boolean;
  channelType: string;
  totalLatencyMs: number;
  playbookIsExperiment: boolean;
}

export class Telemetry {
  constructor(private readonly store: Store) {}

  emit(event: TurnTelemetryEvent): void {
    const log = createLogger({
      tenantId: event.tenantId,
      conversationId: event.conversationId,
      identityId: event.identityId,
    });
    log.info(
      {
        userState: event.userState,
        model: event.model,
        tokens: event.inputTokens + event.outputTokens,
        tools: event.toolCallCount,
        kb: event.kbChunksRetrieved,
        latencyMs: event.totalLatencyMs,
      },
      'turn.completed',
    );
    // Mirror into the audit log for the analytics surface.
    this.store.addAudit({
      id: ulid(),
      tenantId: event.tenantId,
      conversationId: event.conversationId,
      endUserId: event.identityId,
      eventType: 'turn.completed',
      payload: event as unknown as Record<string, unknown>,
      createdAt: new Date(),
    });
  }
}
