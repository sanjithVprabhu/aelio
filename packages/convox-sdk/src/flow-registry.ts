import type { FlowManifest } from './types.js';

function flowKey(manifest: FlowManifest): string {
  return `${manifest.stateKey}:${manifest.objectiveKey}`;
}

export class FlowRegistry {
  private readonly flows = new Map<string, FlowManifest>();

  set(manifest: FlowManifest): void {
    const stateKey = manifest.stateKey.trim();
    const objectiveKey = manifest.objectiveKey.trim();
    if (!stateKey || !objectiveKey) {
      throw new Error('[convox] flow requires non-empty stateKey and objectiveKey.');
    }
    const normalized: FlowManifest = {
      ...manifest,
      stateKey,
      objectiveKey,
      steps: [...manifest.steps].sort((a, b) => a.order - b.order),
      approved: manifest.approved ?? true,
    };
    this.flows.set(flowKey(normalized), normalized);
  }

  delete(stateKey: string, objectiveKey: string): boolean {
    return this.flows.delete(`${stateKey.trim()}:${objectiveKey.trim()}`);
  }

  get(stateKey: string, objectiveKey: string): FlowManifest | undefined {
    return this.flows.get(`${stateKey.trim()}:${objectiveKey.trim()}`);
  }

  listManifests(): FlowManifest[] {
    return [...this.flows.values()].map((f) => ({ ...f, steps: [...f.steps] }));
  }

  clear(): void {
    this.flows.clear();
  }
}