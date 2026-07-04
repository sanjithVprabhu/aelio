import type { StateManifest } from './types.js';

export class StateRegistry {
  private readonly states = new Map<string, StateManifest>();

  set(key: string, manifest: StateManifest): void {
    const normalized = key.trim();
    if (!normalized) throw new Error('[convox] state key must be a non-empty string.');
    this.states.set(normalized, { ...manifest, key: normalized });
  }

  delete(key: string): boolean {
    return this.states.delete(key.trim());
  }

  has(key: string): boolean {
    return this.states.has(key.trim());
  }

  get(key: string): StateManifest | undefined {
    return this.states.get(key.trim());
  }

  listManifests(): StateManifest[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  clear(): void {
    this.states.clear();
  }
}