import type { ActionDefinition, FallbackStep } from '@aelio/types';
import type { Kv } from '../store/kv.js';

export interface FallbackInput {
  conversationId: string;
  originalMessage: string;
  availableActions: ActionDefinition[];
}

export interface FallbackResult {
  strategy: string;
  responseMessage: string;
  correctedMessage?: string;
  shouldEscalate?: boolean;
}

const COMMON_TYPOS: Record<string, string> = {
  cancle: 'cancel',
  recieve: 'receive',
  downgarde: 'downgrade',
  upgade: 'upgrade',
  invioce: 'invoice',
};

/**
 * The fallback ladder (manual §6). Runs ordered strategies, tracking per-strategy
 * attempt counts in the KV so a conversation doesn't loop on the same step, and
 * escalates to a human when the ladder is exhausted.
 */
export class FallbackLadder {
  constructor(private readonly kv: Kv) {}

  async run(input: FallbackInput, ladder: FallbackStep[]): Promise<FallbackResult> {
    const attemptsKey = `fallback_attempts:${input.conversationId}`;
    const attempts = (await this.kv.get<Record<string, number>>(attemptsKey)) ?? {};
    const sorted = [...ladder].sort((a, b) => a.order - b.order);

    for (const step of sorted) {
      const used = attempts[step.strategy] ?? 0;
      if (used >= step.config.maxAttempts) continue;
      attempts[step.strategy] = used + 1;
      await this.kv.set(attemptsKey, attempts, 3600);

      switch (step.strategy) {
        case 'typo_correction': {
          const corrected = correctTypos(input.originalMessage);
          if (corrected !== input.originalMessage) {
            return { strategy: 'typo_correction', responseMessage: '', correctedMessage: corrected };
          }
          continue;
        }
        case 'slot_reprompt':
        case 'rephrase':
          return { strategy: step.strategy, responseMessage: step.config.messageTemplate };
        case 'offer_options': {
          const options = input.availableActions
            .filter((a) => a.exposed)
            .slice(0, 4)
            .map((a) => a.label)
            .join(', ');
          return {
            strategy: 'offer_options',
            responseMessage: step.config.messageTemplate.replace('{options}', options || 'a few things'),
          };
        }
        case 'escalate':
          return { strategy: 'escalate', responseMessage: step.config.messageTemplate, shouldEscalate: true };
      }
    }

    return {
      strategy: 'escalate',
      responseMessage: "I'm having trouble helping with this. Let me connect you with someone who can.",
      shouldEscalate: true,
    };
  }
}

function correctTypos(message: string): string {
  return message
    .split(/(\s+)/)
    .map((w) => COMMON_TYPOS[w.toLowerCase()] ?? w)
    .join('');
}
