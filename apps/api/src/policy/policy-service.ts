import { Errors } from '@aelio/errors';
import { signToken } from '@aelio/crypto';
import {
  ActionTier,
  type ActionDefinition,
  type ActionInvocation,
  type EndUserIdentity,
  type EndUserSession,
  type PreCondition,
} from '@aelio/types';
import type { Store } from '../store/store.js';
import type { Kv } from '../store/kv.js';
import { ulid } from '../util/id.js';
import type { ConvoxExecutor } from '../convox/executor.js';
import {
  extractAuditFields,
  redactPII,
  renderTemplate,
  validateConstraints,
  validateSchema,
} from './util.js';

/** Step-up surface the policy layer depends on (implemented by SessionService). */
export interface StepUpPort {
  isStepUpValid(session: EndUserSession): boolean;
  initiateStepUp(session: EndUserSession): Promise<{ url: string }>;
}

export interface ActionExecutionRequest {
  tenantId: string;
  identity: EndUserIdentity;
  session: EndUserSession;
  actionKey: string;
  args: Record<string, unknown>;
  conversationId: string;
  /** Playbook behavior bundle's confirmation threshold (default 1). */
  requireConfirmationForTier?: number;
  /** End-user permissions (from SaaS context) for the permission gate. */
  userPermissions?: string[];
}

export interface ActionExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  auditEventId: string;
  requiresConfirmation?: {
    message: string;
    actionKey: string;
    confirmedArgs: Record<string, unknown>;
    expiresAt: Date;
    token: string;
  };
  requiresStepUp?: { url: string };
  /** Human-readable reason when an action is blocked by a gate. */
  blockedReason?: string;
}

interface PendingConfirmation {
  token: string;
  confirmedArgs: Record<string, unknown>;
  expiresAt: number;
}

export class PolicyService {
  constructor(
    private readonly store: Store,
    private readonly kv: Kv,
    private readonly executor: ConvoxExecutor,
    private readonly stepUp: StepUpPort,
  ) {}

  private confirmKey(tenantId: string, conversationId: string, actionKey: string): string {
    return `pending_confirmation:${tenantId}:${conversationId}:${actionKey}`;
  }

  /** The seven gates. Every tool call from the agent passes through here. */
  async executeAction(req: ActionExecutionRequest): Promise<ActionExecutionResult> {
    const auditEventId = ulid();
    const requireTier = req.requireConfirmationForTier ?? 1;

    // GATE 1 — load + exposed
    const action = this.store.getActionByKey(req.tenantId, req.actionKey);
    if (!action || !action.exposed) {
      this.audit(auditEventId, req, 'action.not_exposed');
      this.invocation(auditEventId, req, ActionTier.Read, 'blocked');
      return {
        success: false,
        auditEventId,
        blockedReason: `Action '${req.actionKey}' is not available.`,
      };
    }

    // GATE 2 — permissions
    if (action.requiredPermissions.length > 0) {
      const perms = req.userPermissions ?? [];
      if (!action.requiredPermissions.every((p) => perms.includes(p))) {
        this.audit(auditEventId, req, 'action.permission_denied', { actionKey: action.key });
        this.invocation(auditEventId, req, action.tier, 'blocked');
        return {
          success: false,
          auditEventId,
          blockedReason: `You don't have permission to ${action.label.toLowerCase()}.`,
        };
      }
    }

    // GATE 3 — schema validation
    const schemaErrors = validateSchema(req.args, action.inputSchema);
    if (schemaErrors.length > 0) {
      this.audit(auditEventId, req, 'action.validation_failed', { errors: schemaErrors });
      return {
        success: false,
        auditEventId,
        blockedReason: schemaErrors.join('; '),
      };
    }

    // GATE 4 — argument constraints
    const constraintErrors = validateConstraints(req.args, action.argConstraints);
    if (constraintErrors.length > 0) {
      this.audit(auditEventId, req, 'action.constraint_violated', { errors: constraintErrors });
      return { success: false, auditEventId, blockedReason: constraintErrors.join('; ') };
    }

    // GATE 5 — pre-conditions
    const preErr = this.checkPreConditions(action.preConditions, req);
    if (preErr) {
      this.audit(auditEventId, req, 'action.precondition_failed', { reason: preErr });
      return { success: false, auditEventId, blockedReason: preErr };
    }

    // GATE 6 — rate limit (per user per action per hour)
    if (action.rateLimitPerUserPerHour > 0) {
      const rlKey = `ratelimit:action:${req.tenantId}:${req.identity.id}:${action.key}`;
      const count = await this.kv.incr(rlKey);
      if (count === 1) await this.kv.expire(rlKey, 3600);
      if (count > action.rateLimitPerUserPerHour) {
        this.audit(auditEventId, req, 'action.rate_limited', { actionKey: action.key });
        this.invocation(auditEventId, req, action.tier, 'blocked');
        throw Errors.rateLimited(3600_000);
      }
    }

    let effectiveArgs = req.args;

    // GATE 7a — confirmation (Tier >= threshold)
    const needsConfirmation = action.tier >= Math.max(1, requireTier);
    let pending: PendingConfirmation | null = null;
    if (needsConfirmation) {
      pending = await this.kv.get<PendingConfirmation>(
        this.confirmKey(req.tenantId, req.conversationId, action.key),
      );
      if (!pending) {
        const message = renderTemplate(
          action.confirmationCopy ?? `Please confirm: ${action.label}.`,
          req.args,
        );
        const token = signToken(
          { tenantId: req.tenantId, endUserId: req.identity.id, purpose: 'confirmation' },
          300,
        );
        const expiresAt = Date.now() + 300_000;
        await this.kv.set(
          this.confirmKey(req.tenantId, req.conversationId, action.key),
          { token, confirmedArgs: req.args, expiresAt } satisfies PendingConfirmation,
          300,
        );
        this.audit(auditEventId, req, 'action.confirmation_requested', { actionKey: action.key });
        return {
          success: false,
          auditEventId,
          requiresConfirmation: {
            message,
            actionKey: action.key,
            confirmedArgs: req.args,
            expiresAt: new Date(expiresAt),
            token,
          },
        };
      }
    }

    // GATE 7b — step-up (Tier 3 / stepUpRequired). Checked BEFORE consuming the
    // confirmation, so the locked confirmation survives the step-up round-trip.
    if (action.tier === ActionTier.Destructive || action.stepUpRequired) {
      if (!this.stepUp.isStepUpValid(req.session)) {
        const { url } = await this.stepUp.initiateStepUp(req.session);
        this.audit(auditEventId, req, 'action.step_up_required', { actionKey: action.key });
        return { success: false, auditEventId, requiresStepUp: { url } };
      }
    }

    // Consume the confirmation (TOCTOU: execute with the args locked at
    // confirmation time, not whatever the LLM re-sent).
    if (pending) {
      effectiveArgs = pending.confirmedArgs;
      await this.kv.del(this.confirmKey(req.tenantId, req.conversationId, action.key));
    }

    // EXECUTE
    this.audit(auditEventId, req, 'action.invoked', {
      actionKey: action.key,
      tier: action.tier,
      args: redactPII(effectiveArgs, action.auditFields),
    });
    this.invocation(auditEventId, req, action.tier, 'invoked', effectiveArgs, action.auditFields);

    const started = Date.now();
    try {
      const data = await this.executor.call(
        req.tenantId,
        req.identity,
        req.session,
        action,
        effectiveArgs,
        auditEventId,
      );
      this.audit(auditEventId, req, 'action.succeeded', {
        actionKey: action.key,
        responseFields: extractAuditFields(data, action.auditFields),
      });
      this.invocation(
        auditEventId,
        req,
        action.tier,
        'succeeded',
        effectiveArgs,
        action.auditFields,
        Date.now() - started,
        extractAuditFields(data, action.auditFields),
      );
      return { success: true, data, auditEventId };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      this.audit(auditEventId, req, 'action.failed', { actionKey: action.key, error });
      this.invocation(
        auditEventId,
        req,
        action.tier,
        'failed',
        effectiveArgs,
        action.auditFields,
        Date.now() - started,
        undefined,
        error,
      );
      return { success: false, error, auditEventId };
    }
  }

  private checkPreConditions(
    preConditions: PreCondition[],
    req: ActionExecutionRequest,
  ): string | null {
    for (const pre of preConditions) {
      if (pre.type === 'session_step_up_valid') {
        if (!this.stepUp.isStepUpValid(req.session)) return 'Step-up verification required.';
      } else if (pre.type === 'user_context_field') {
        const ctx = req.identity.metadata as Record<string, unknown>;
        const actual = ctx[pre.field];
        const ok =
          pre.operator === '=='
            ? actual === pre.value
            : pre.operator === '!='
              ? actual !== pre.value
              : pre.operator === '>'
                ? Number(actual) > Number(pre.value)
                : Number(actual) < Number(pre.value);
        if (!ok) return `Pre-condition failed on ${pre.field}.`;
      }
    }
    return null;
  }

  private audit(
    id: string,
    req: ActionExecutionRequest,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): void {
    this.store.addAudit({
      id: `${id}:${eventType}`,
      tenantId: req.tenantId,
      conversationId: req.conversationId,
      endUserId: req.identity.id,
      eventType,
      payload,
      createdAt: new Date(),
    });
  }

  private invocation(
    id: string,
    req: ActionExecutionRequest,
    tier: ActionTier,
    status: ActionInvocation['status'],
    args: Record<string, unknown> = {},
    auditFields: string[] = [],
    latencyMs?: number,
    responseFields?: Record<string, unknown>,
    errorMessage?: string,
  ): void {
    this.store.addInvocation({
      id: `${id}:${status}`,
      tenantId: req.tenantId,
      conversationId: req.conversationId,
      identityId: req.identity.id,
      actionKey: req.actionKey,
      tier,
      status,
      argsRedacted: redactPII(args, auditFields),
      responseFields,
      errorMessage,
      latencyMs,
      createdAt: new Date(),
    });
  }
}
