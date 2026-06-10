export enum ErrorCode {
  // Auth
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  MagicLinkExpired = 'MAGIC_LINK_EXPIRED',
  StepUpRequired = 'STEP_UP_REQUIRED',

  // Tenant / config
  TenantNotFound = 'TENANT_NOT_FOUND',
  TenantSuspended = 'TENANT_SUSPENDED',
  PlaybookNotFound = 'PLAYBOOK_NOT_FOUND',

  // Integration
  SaaSAPIError = 'SAAS_API_ERROR',
  SaaSAPITimeout = 'SAAS_API_TIMEOUT',
  ActionNotPermitted = 'ACTION_NOT_PERMITTED',
  ActionTierViolation = 'ACTION_TIER_VIOLATION',
  RateLimitExceeded = 'RATE_LIMIT_EXCEEDED',

  // LLM
  LLMProviderError = 'LLM_PROVIDER_ERROR',
  LLMKeyInvalid = 'LLM_KEY_INVALID',

  // Channel
  ChannelNotActive = 'CHANNEL_NOT_ACTIVE',
  ChannelVerificationFailed = 'CHANNEL_VERIFICATION_FAILED',

  // General
  InternalError = 'INTERNAL_ERROR',
  NotFound = 'NOT_FOUND',
  ValidationError = 'VALIDATION_ERROR',
  ConflictError = 'CONFLICT_ERROR',
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON(): { code: ErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const Errors = {
  unauthorized: (msg = 'Unauthorized') => new AppError(ErrorCode.Unauthorized, msg, 401),
  forbidden: (msg = 'Forbidden') => new AppError(ErrorCode.Forbidden, msg, 403),
  notFound: (entity: string, id: string) =>
    new AppError(ErrorCode.NotFound, `${entity} not found: ${id}`, 404),
  validation: (details: Record<string, unknown>) =>
    new AppError(ErrorCode.ValidationError, 'Validation failed', 422, details),
  conflict: (msg: string) => new AppError(ErrorCode.ConflictError, msg, 409),
  tenantNotFound: (id: string) =>
    new AppError(ErrorCode.TenantNotFound, `Tenant not found: ${id}`, 404),
  actionTierViolation: (action: string, tier: number) =>
    new AppError(
      ErrorCode.ActionTierViolation,
      `Action '${action}' requires tier ${tier} confirmation`,
      403,
      { action, tier },
    ),
  rateLimited: (retryAfterMs: number) =>
    new AppError(ErrorCode.RateLimitExceeded, 'Rate limit exceeded', 429, { retryAfterMs }),
  saasApiError: (status: number, body: string, actionKey: string) =>
    new AppError(
      ErrorCode.SaaSAPIError,
      `SaaS API returned ${status}: ${body.slice(0, 200)}`,
      status,
      { actionKey, status },
    ),
  llmProviderError: (msg: string) => new AppError(ErrorCode.LLMProviderError, msg, 502),
  internal: (msg = 'Internal error') =>
    new AppError(ErrorCode.InternalError, msg, 500, undefined, false),
};
