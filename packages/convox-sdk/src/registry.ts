import type { ToolDefinition, ToolManifest } from './types.js';

interface RegisteredTool {
  manifest: ToolManifest;
  handler: ToolDefinition['handler'];
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  set<TArgs, TResult>(key: string, definition: ToolDefinition<TArgs, TResult>): void {
    const normalized = key.trim();
    if (!normalized) throw new Error('[convox] tool key must be a non-empty string.');
    this.tools.set(normalized, {
      manifest: {
        key: normalized,
        description: definition.description,
        inputSchema: definition.inputSchema,
        version: definition.version,
        policy: definition.policy,
      },
      handler: definition.handler as ToolDefinition['handler'],
    });
  }

  delete(key: string): boolean {
    return this.tools.delete(key.trim());
  }

  has(key: string): boolean {
    return this.tools.has(key.trim());
  }

  getHandler(key: string): ToolDefinition['handler'] | undefined {
    return this.tools.get(key.trim())?.handler;
  }

  listManifests(): ToolManifest[] {
    return [...this.tools.values()].map((t) => ({ ...t.manifest }));
  }

  keys(): string[] {
    return [...this.tools.keys()];
  }

  clear(): void {
    this.tools.clear();
  }
}