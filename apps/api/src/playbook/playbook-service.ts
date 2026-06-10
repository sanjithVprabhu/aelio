import { createHash } from 'node:crypto';
import { PlaybookStatus, type DeploymentMode, type Playbook } from '@aelio/types';
import type { Store } from '../store/store.js';

/** Deterministic 0–99 bucket for a conversation, for gradual rollout. */
export function rolloutBucket(conversationId: string): number {
  const h = createHash('md5').update(conversationId).digest();
  return ((h[0]! << 8) | h[1]!) % 100;
}

export interface DeployOptions {
  mode: DeploymentMode;
  gradualRolloutPercent?: number;
}

export interface PreflightResult {
  ok: boolean;
  checks: Array<{ label: string; passed: boolean; blocker: boolean }>;
}

/**
 * Layer 4 — playbook deployment, versioning, and gradual rollout. Selecting the
 * playbook for a conversation honors shadow/gradual experiments deterministically
 * by conversation hash, so a given user gets a stable experience.
 */
export class PlaybookService {
  constructor(private readonly store: Store) {}

  list(tenantId: string): Playbook[] {
    return this.store
      .listPlaybooks(tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  preflight(tenantId: string, playbook: Playbook): PreflightResult {
    const exposed = this.store.listExposedActions(tenantId);
    const checks = [
      { label: 'At least one action exposed', passed: exposed.length > 0, blocker: true },
      {
        label: 'Every state has a persona',
        passed: playbook.lifecycle.states.every((s) => s.behavior.persona.length > 0),
        blocker: true,
      },
      {
        label: 'Escalate is the final fallback step',
        passed:
          playbook.fallbackLadder.length === 0 ||
          playbook.fallbackLadder.sort((a, b) => a.order - b.order).at(-1)?.strategy === 'escalate',
        blocker: true,
      },
      { label: 'A default state is set', passed: !!playbook.lifecycle.defaultState, blocker: true },
    ];
    return { ok: checks.every((c) => !c.blocker || c.passed), checks };
  }

  deploy(tenantId: string, playbookId: string, opts: DeployOptions): Playbook {
    const playbook = this.store.getPlaybook(tenantId, playbookId);
    if (!playbook) throw new Error('playbook not found');

    if (opts.mode === 'immediate') {
      // Archive the current active version, activate this one.
      for (const p of this.store.listPlaybooks(tenantId)) {
        if (p.status === PlaybookStatus.Active && p.id !== playbookId) {
          p.status = PlaybookStatus.Archived;
          this.store.putPlaybook(p);
        }
      }
      playbook.status = PlaybookStatus.Active;
      playbook.deploymentMode = 'immediate';
      playbook.gradualRolloutPercent = undefined;
    } else if (opts.mode === 'shadow') {
      playbook.status = PlaybookStatus.Shadow;
      playbook.deploymentMode = 'shadow';
    } else {
      playbook.status = PlaybookStatus.Gradual;
      playbook.deploymentMode = 'gradual';
      playbook.gradualRolloutPercent = opts.gradualRolloutPercent ?? 10;
    }
    playbook.publishedAt = new Date();
    this.store.putPlaybook(playbook);
    return playbook;
  }

  archive(tenantId: string, playbookId: string): void {
    const p = this.store.getPlaybook(tenantId, playbookId);
    if (p) {
      p.status = PlaybookStatus.Archived;
      this.store.putPlaybook(p);
    }
  }

  /** Pick the playbook version for a conversation (handles gradual experiments). */
  select(tenantId: string, conversationId: string): { playbook: Playbook; isExperiment: boolean } | null {
    const all = this.store.listPlaybooks(tenantId);
    const active = all.find((p) => p.status === PlaybookStatus.Active);
    const gradual = all.find((p) => p.status === PlaybookStatus.Gradual);

    if (gradual && active) {
      const bucket = rolloutBucket(conversationId);
      if (bucket < (gradual.gradualRolloutPercent ?? 0)) {
        return { playbook: gradual, isExperiment: true };
      }
      return { playbook: active, isExperiment: false };
    }
    const chosen = active ?? all.find((p) => p.status === PlaybookStatus.Draft) ?? all[0];
    return chosen ? { playbook: chosen, isExperiment: chosen.status !== PlaybookStatus.Active } : null;
  }

  diff(a: Playbook, b: Playbook): { statesAdded: string[]; statesRemoved: string[]; triggersChanged: number } {
    const aKeys = new Set(a.lifecycle.states.map((s) => s.key));
    const bKeys = new Set(b.lifecycle.states.map((s) => s.key));
    return {
      statesAdded: [...bKeys].filter((k) => !aKeys.has(k)),
      statesRemoved: [...aKeys].filter((k) => !bKeys.has(k)),
      triggersChanged: Math.abs(a.triggers.length - b.triggers.length),
    };
  }
}
