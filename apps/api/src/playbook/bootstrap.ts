import {
  PlaybookStatus,
  type BehaviorBundle,
  type Playbook,
  type PlaybookState,
} from '@aelio/types';
import { uuid } from '../util/id.js';

function bundle(partial: Partial<BehaviorBundle> & Pick<BehaviorBundle, 'persona'>): BehaviorBundle {
  return {
    toneGuidelines: ['Be warm and concise', 'Confirm before changing anything'],
    openingBehavior: 'brief_greeting',
    allowedActionKeys: ['*'],
    kbScopeIds: [],
    skillPacks: [],
    confidenceFloor: 0.6,
    requireConfirmationForTier: 1,
    ...partial,
  };
}

/**
 * Auto-generate a draft playbook from a spec's action keys. In production the
 * manual calls an LLM to design this; the deterministic default here gives the
 * same shape — five lifecycle states, a retention trigger, and a fallback
 * ladder — so onboarding produces a working bot immediately.
 */
export function buildDefaultPlaybook(
  tenantId: string,
  tenantName: string,
  specId?: string,
): Playbook {
  const states: PlaybookState[] = [
    {
      key: 'unverified',
      label: 'Unverified',
      description: 'User has not yet verified their identity.',
      inferenceHints: ['No verified identity on file'],
      behavior: bundle({
        persona: `You are the assistant for ${tenantName}. The user is not verified yet — be welcoming and explain you can help once they confirm their identity via the secure link.`,
        openingBehavior: 'full_intro',
        allowedActionKeys: [],
        requireConfirmationForTier: 1,
      }),
    },
    {
      key: 'onboarding',
      label: 'Onboarding',
      description: 'New, recently verified user finding their feet.',
      inferenceHints: ['Account younger than 14 days', 'Asks how-to questions'],
      behavior: bundle({
        persona: `You are the assistant for ${tenantName}. The user is new — be patient, proactive, and guide them to their first win.`,
        openingBehavior: 'full_intro',
        toneGuidelines: ['Be encouraging', 'Offer the next step', 'Confirm before changes'],
      }),
    },
    {
      key: 'active',
      label: 'Active',
      description: 'Engaged user doing routine work.',
      inferenceHints: ['Verified and regularly active'],
      behavior: bundle({
        persona: `You are the assistant for ${tenantName}. Be efficient and get things done with minimal friction.`,
        openingBehavior: 'skip_to_intent',
      }),
    },
    {
      key: 'power_user',
      label: 'Power user',
      description: 'Advanced, high-frequency user.',
      inferenceHints: ['Uses API/automation', 'Has upgraded'],
      behavior: bundle({
        persona: `You are the assistant for ${tenantName}. The user is advanced — be terse, skip the basics, and surface power features.`,
        openingBehavior: 'skip_to_intent',
        toneGuidelines: ['Be terse', 'Assume expertise'],
        requireConfirmationForTier: 2,
      }),
    },
    {
      key: 'at_risk',
      label: 'At risk',
      description: 'User showing churn or cancellation signals.',
      inferenceHints: ['Mentions cancelling', 'Repeated failures', 'Long absence'],
      behavior: bundle({
        persona: `You are the retention-aware assistant for ${tenantName}. The user may be considering leaving — be empathetic, acknowledge their concern, resolve the underlying issue, and never pressure them.`,
        openingBehavior: 'retention_mode',
        toneGuidelines: ['Lead with empathy', 'Acknowledge frustration', 'Offer real help, not pressure'],
      }),
    },
  ];

  return {
    id: uuid(),
    tenantId,
    version: '1.0.0',
    status: PlaybookStatus.Active,
    deploymentMode: 'immediate',
    lifecycle: { defaultState: 'unverified', states },
    triggers: [
      {
        id: uuid(),
        label: 'Cancellation intent → move to retention',
        enabled: true,
        event: { type: 'message_received' },
        condition: {
          type: 'message_contains',
          phrases: ['cancel', 'downgrade', 'refund', 'leave'],
          matchType: 'any',
        },
        action: { type: 'transition_state', targetState: 'at_risk' },
      },
      {
        id: uuid(),
        label: 'Explicit human request → escalate',
        enabled: true,
        event: { type: 'message_received' },
        condition: {
          type: 'message_contains',
          phrases: ['speak to a human', 'talk to someone', 'representative', 'agent please'],
          matchType: 'any',
        },
        action: { type: 'escalate_to_human', reason: 'User asked for a human', priority: 'normal' },
      },
    ],
    fallbackLadder: [
      { order: 1, strategy: 'rephrase', config: { maxAttempts: 1, messageTemplate: "Sorry — I didn't quite catch that. Could you say it another way?" } },
      { order: 2, strategy: 'offer_options', config: { maxAttempts: 1, messageTemplate: 'Here are a few things I can help with: {options}.' } },
      { order: 3, strategy: 'escalate', config: { maxAttempts: 1, messageTemplate: "Let me connect you with someone from the team who can help." } },
    ],
    messageTemplates: {
      retention_acknowledge: "I hear you, and I want to make this right.",
    },
    bootstrappedFromSpecId: specId,
    createdAt: new Date(),
    publishedAt: new Date(),
  };
}
