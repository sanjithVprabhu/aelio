import {
  ActionTier,
  SpecFormat,
  type ActionDefinition,
  type ApiSpec,
  type IngestionResult,
  type JSONSchema,
  type ParsedAction,
} from '@aelio/types';
import type { Store } from '../store/store.js';
import { uuid } from '../util/id.js';
import { parseSpec } from './parsers.js';

function humanLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function firstArgPlaceholder(schema: JSONSchema): string | undefined {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props) return undefined;
  const first = Object.keys(props)[0];
  return first ? `{${first}}` : undefined;
}

function defaultConfirmationCopy(action: ParsedAction): string | undefined {
  if (action.suggestedTier === ActionTier.Read) return undefined;
  const label = humanLabel(action.key).toLowerCase();
  const arg = firstArgPlaceholder(action.inputSchema);
  return arg
    ? `You're about to ${label} (${arg}). Shall I go ahead?`
    : `You're about to ${label}. Shall I go ahead?`;
}

function defaultPostMessage(action: ParsedAction): string {
  if (action.suggestedTier === ActionTier.Read) return '';
  return `Done — ${humanLabel(action.key).toLowerCase()} is complete.`;
}

/** Convert a parsed action into a policy-enriched ActionDefinition. */
export function buildActionDefinition(
  tenantId: string,
  specId: string,
  baseUrl: string,
  pa: ParsedAction,
  exposed: boolean,
): ActionDefinition {
  const now = new Date();
  return {
    id: uuid(),
    tenantId,
    specId,
    key: pa.key,
    label: humanLabel(pa.key),
    description: pa.description,
    httpMethod: pa.httpMethod,
    path: pa.path,
    baseUrl,
    inputSchema: pa.inputSchema,
    outputSchema: pa.outputSchema,
    exposed,
    tier: pa.suggestedTier,
    requiredPermissions: [],
    confirmationCopy: defaultConfirmationCopy(pa),
    beforeAfterTemplate: undefined,
    stepUpRequired: pa.suggestedTier === ActionTier.Destructive,
    rateLimitPerUserPerHour: pa.suggestedTier === ActionTier.Destructive ? 3 : 0,
    argConstraints: [],
    preConditions: [],
    postActionMessage: defaultPostMessage(pa),
    auditFields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface IngestInput {
  tenantId: string;
  raw: string;
  /** Override base URL (e.g. when the spec omits servers). */
  baseUrl?: string;
  /** Expose actions on ingest (onboarding "expose all"). Default Tier 0 only. */
  exposeAll?: boolean;
}

export class SpecService {
  constructor(private readonly store: Store) {}

  ingest(input: IngestInput): { spec: ApiSpec; result: IngestionResult; actions: ActionDefinition[] } {
    const result = parseSpec(input.raw);
    const baseUrl = input.baseUrl ?? '';
    const specId = uuid();

    const spec: ApiSpec = {
      id: specId,
      tenantId: input.tenantId,
      format: result.format ?? SpecFormat.OpenAPI3,
      baseUrl,
      rawContent: input.raw,
      parsedActions: result.parsedActions,
      warnings: result.warnings,
      createdAt: new Date(),
    };
    this.store.putSpec(spec);

    const actions: ActionDefinition[] = [];
    for (const pa of result.parsedActions) {
      const exposed = input.exposeAll ?? false;
      const action = buildActionDefinition(input.tenantId, specId, baseUrl, pa, exposed);
      this.store.putAction(action);
      actions.push(action);
    }

    return { spec: { ...spec, id: specId }, result: { ...result, specId }, actions };
  }
}
