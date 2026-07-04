import type { Kv } from '../store/kv.js';

const SNAPSHOT_TTL_S = 300;

function key(tenantId: string, identityId: string, toolKey: string): string {
  return `env_snapshot:${tenantId}:${identityId}:${toolKey}`;
}

export interface EnvSnapshot {
  toolKey: string;
  payload: unknown;
  fetchedAt: number;
  expiresAt: number;
}

export async function getEnvSnapshot(
  kv: Kv,
  tenantId: string,
  identityId: string,
  toolKey: string,
): Promise<EnvSnapshot | null> {
  const snap = await kv.get<EnvSnapshot>(key(tenantId, identityId, toolKey));
  if (!snap) return null;
  if (Date.now() > snap.expiresAt) return null;
  return snap;
}

export async function putEnvSnapshot(
  kv: Kv,
  tenantId: string,
  identityId: string,
  toolKey: string,
  payload: unknown,
): Promise<void> {
  const now = Date.now();
  await kv.set(
    key(tenantId, identityId, toolKey),
    {
      toolKey,
      payload,
      fetchedAt: now,
      expiresAt: now + SNAPSHOT_TTL_S * 1000,
    },
    SNAPSHOT_TTL_S,
  );
}

export function buildEnvSnapshotBlock(snapshots: EnvSnapshot[]): string | undefined {
  if (!snapshots.length) return undefined;
  const lines = snapshots.map((s) => `- ${s.toolKey}: ${JSON.stringify(s.payload)}`);
  return `\n\n## Environment snapshot (tier-0 cache)\n${lines.join('\n')}`;
}