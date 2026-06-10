import { ActionTier } from '@aelio/types';

const DESTRUCTIVE = [
  'delete',
  'cancel',
  'terminate',
  'remove',
  'purge',
  'refund',
  'transfer',
  'close',
  'deactivate',
  'wipe',
];
const FINANCIAL = ['payment', 'charge', 'invoice', 'billing', 'subscription', 'payout', 'refund'];

/**
 * Infer the safety tier for an endpoint from its HTTP method and naming.
 * Destructive/financial verbs dominate; otherwise method drives the tier.
 */
export function inferTier(method: string | undefined, keyOrSummary: string): ActionTier {
  const haystack = keyOrSummary.toLowerCase();
  const m = (method ?? 'POST').toUpperCase();

  if (DESTRUCTIVE.some((w) => haystack.includes(w))) return ActionTier.Destructive;
  if (m === 'POST' && FINANCIAL.some((w) => haystack.includes(w))) return ActionTier.Destructive;

  switch (m) {
    case 'GET':
    case 'HEAD':
      return ActionTier.Read;
    case 'PUT':
    case 'PATCH':
      return ActionTier.StateUpdate;
    case 'DELETE':
      return ActionTier.Destructive;
    case 'POST':
    default:
      return ActionTier.ReversibleWrite;
  }
}

export function tierLabel(tier: ActionTier): string {
  return (
    {
      [ActionTier.Read]: 'Read',
      [ActionTier.ReversibleWrite]: 'Reversible write',
      [ActionTier.StateUpdate]: 'State update',
      [ActionTier.Destructive]: 'Destructive / financial',
    }[tier] ?? 'Unknown'
  );
}
