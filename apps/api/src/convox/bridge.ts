import { ActionTier, type ActionDefinition } from '@aelio/types';
import type { ToolManifest } from '@aelio/convox-sdk';
import type { Store } from '../store/store.js';
import type { ConvoxRegistry } from './registry.js';
import { uuid } from '../util/id.js';
import { demoToolTiers } from './demo-tools.js';

/** Stable UUID for Convox-registered actions (Postgres `spec_id` is uuid). */
export const CONVOX_SPEC_ID = '00000000-0000-4000-8000-0000000000c0';
/** Placeholder playbook id for Convox-era conversations (Postgres `playbook_id` is uuid). */
export const CONVOX_PLAYBOOK_ID = '00000000-0000-4000-8000-0000000000c1';

/** Map Convox tool manifests into policy-layer ActionDefinitions. */
export class ConvoxBridge {
  constructor(
    private readonly store: Store,
    private readonly registry: ConvoxRegistry,
  ) {}

  syncFromRegistry(tenantId: string): void {
    const manifests = this.registry.listTools(tenantId);
    const liveKeys = new Set(manifests.map((m) => m.key));
    const hasConnection = this.registry.listConnections(tenantId).length > 0;

    for (const manifest of manifests) {
      const existing = this.store.getActionByKey(tenantId, manifest.key);
      const action = toActionDefinition(tenantId, manifest, existing);
      this.store.putAction(action);
    }

    // Only prune when a live connection is present — avoids wiping the catalog during
    // reconnect races or transient empty registry snapshots.
    if (!hasConnection) return;

    for (const action of this.store.listActions(tenantId)) {
      if (action.specId !== CONVOX_SPEC_ID || liveKeys.has(action.key)) continue;
      this.store.deleteAction(tenantId, action.id);
    }
  }

  tenantHasLiveTools(tenantId: string): boolean {
    return this.registry.listTools(tenantId).length > 0;
  }
}

function toActionDefinition(
  tenantId: string,
  manifest: ToolManifest,
  existing?: ActionDefinition,
): ActionDefinition {
  const now = new Date();
  const policy = manifest.policy;
  const tier =
    policy?.tier ??
    existing?.tier ??
    demoToolTiers()[manifest.key] ??
    inferTier(manifest.key);
  return {
    id: existing?.id ?? uuid(),
    tenantId,
    specId: CONVOX_SPEC_ID,
    key: manifest.key,
    label: humanLabel(manifest.key),
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    baseUrl: 'convox://live',
    exposed: policy?.exposed ?? existing?.exposed ?? true,
    tier,
    requiredPermissions: policy?.requiredPermissions ?? existing?.requiredPermissions ?? [],
    confirmationCopy:
      policy?.confirmationCopy ??
      existing?.confirmationCopy ??
      defaultConfirmation(manifest.key, tier),
    stepUpRequired:
      policy?.stepUpRequired ?? existing?.stepUpRequired ?? tier === ActionTier.Destructive,
    rateLimitPerUserPerHour:
      policy?.rateLimitPerUserPerHour ??
      existing?.rateLimitPerUserPerHour ??
      (tier === ActionTier.Destructive ? 3 : 0),
    argConstraints: existing?.argConstraints ?? [],
    preConditions: existing?.preConditions ?? [],
    postActionMessage: existing?.postActionMessage ?? '',
    auditFields: existing?.auditFields ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function inferTier(key: string): ActionTier {
  const k = key.toLowerCase();
  if (k.includes('cancel') || k.includes('delete') || k.includes('terminate')) {
    return ActionTier.Destructive;
  }
  if (k.includes('update') || k.includes('change') || k.includes('create') || k.includes('schedule')) {
    return ActionTier.StateUpdate;
  }
  if (k.includes('share') || k.includes('invite') || k.includes('grant')) {
    return ActionTier.ReversibleWrite;
  }
  return ActionTier.Read;
}

function humanLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function defaultConfirmation(key: string, tier: ActionTier): string | undefined {
  if (tier === ActionTier.Read) return undefined;
  return `You're about to ${humanLabel(key).toLowerCase()}. Shall I go ahead?`;
}