import { Errors } from '@aelio/errors';
import { ActionTier, type ActionDefinition, type EndUserIdentity, type EndUserSession } from '@aelio/types';
import type { Store } from '../store/store.js';
import type { StepUpPort } from '../policy/policy-service.js';
import type { ConvoxRegistry } from './registry.js';

/** Routes policy-approved tool calls to live Convox SDK handlers. */
export class ConvoxExecutor {
  constructor(
    private readonly store: Store,
    private readonly registry: ConvoxRegistry,
    private readonly stepUp: StepUpPort,
  ) {}

  async call(
    tenantId: string,
    identity: EndUserIdentity,
    session: EndUserSession,
    action: ActionDefinition,
    args: Record<string, unknown>,
    invocationId: string,
  ): Promise<unknown> {
    const apiKey = this.store.getTenantApiKey(tenantId);
    if (!apiKey) {
      throw Errors.saasApiError(503, 'Tenant Convox API key is not configured.', action.key);
    }

    if (action.tier > ActionTier.Read && !this.registry.hasLiveConnection(tenantId)) {
      throw Errors.saasApiError(
        503,
        'Convox connection is offline — read-only mode. Reconnect your Convox SDK to perform writes.',
        action.key,
      );
    }

    const meta = identity.metadata as Record<string, unknown>;
    const tenantSlug = this.store.getTenant(tenantId)?.slug ?? tenantId;
    return this.registry.execute(tenantId, apiKey, {
      tool: action.key,
      args,
      context: {
        invocationId,
        tenantId: tenantSlug,
        externalUserId: identity.externalUserId,
        email: typeof meta.email === 'string' ? meta.email : undefined,
        verified: true,
        stepUpValid: this.stepUp.isStepUpValid(session),
        metadata: meta,
      },
    });
  }
}