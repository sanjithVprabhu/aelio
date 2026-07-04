import type { FlowManifest } from '@aelio/convox-sdk';
import type { FlowDefinition } from '../flows/flow-engine.js';
import type { FlowStore } from '../flows/flow-store.js';
import type { ConvoxRegistry } from './registry.js';
import { stableUuid } from '../util/id.js';

function flowId(stateKey: string, objectiveKey: string): string {
  return stableUuid(`convox-flow:${stateKey}:${objectiveKey}`);
}

function toFlowDefinition(manifest: FlowManifest): FlowDefinition {
  return {
    id: flowId(manifest.stateKey, manifest.objectiveKey),
    objectiveKey: manifest.objectiveKey,
    stateKey: manifest.stateKey,
    steps: manifest.steps,
  };
}

/** Persist Convox flow manifests to Postgres and refresh the agent runtime. */
export class ConvoxFlowBridge {
  constructor(
    private readonly flowStore: FlowStore,
    private readonly registry: ConvoxRegistry,
  ) {}

  /** Upsert all live flows for a tenant into durable storage. */
  async syncFromRegistry(tenantId: string): Promise<FlowDefinition[]> {
    const flows = this.registry.listFlows(tenantId);
    if (!this.flowStore.canPersist) {
      return flows.length > 0 ? flows.map(toFlowDefinition) : this.flowStore.defaultFlows();
    }
    const liveKeys = new Set(flows.map((flow) => `${flow.stateKey}:${flow.objectiveKey}`));
    const hasConnection = this.registry.listConnections(tenantId).length > 0;
    for (const flow of flows) {
      await this.upsert(tenantId, flow);
    }
    if (hasConnection) {
      const existing = await this.flowStore.listAll(tenantId);
      for (const flow of existing) {
        const key = `${flow.stateKey}:${flow.objectiveKey}`;
        if (liveKeys.has(key)) continue;
        await this.flowStore.remove(tenantId, flow.stateKey, flow.objectiveKey);
      }
    }
    return this.flowStore.listApproved(tenantId);
  }

  async upsert(tenantId: string, manifest: FlowManifest): Promise<void> {
    if (!this.flowStore.canPersist) return;
    await this.flowStore.upsert(tenantId, {
      id: flowId(manifest.stateKey, manifest.objectiveKey),
      objectiveKey: manifest.objectiveKey,
      stateKey: manifest.stateKey,
      steps: manifest.steps,
      approved: manifest.approved ?? true,
    });
  }

  async remove(tenantId: string, stateKey: string, objectiveKey: string): Promise<FlowDefinition[]> {
    if (this.flowStore.canPersist) {
      await this.flowStore.remove(tenantId, stateKey, objectiveKey);
      return this.flowStore.listApproved(tenantId);
    }
    const remaining = this.registry
      .listFlows(tenantId)
      .filter((f) => !(f.stateKey === stateKey && f.objectiveKey === objectiveKey));
    return remaining.length > 0 ? remaining.map(toFlowDefinition) : this.flowStore.defaultFlows();
  }
}
