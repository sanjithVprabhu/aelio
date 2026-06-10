import {
  ActionTier,
  type ActionDefinition,
  type ArgConstraint,
  type JSONSchema,
  type LLMTool,
} from '@aelio/types';

/** Render `{field}` placeholders from an args map. */
export function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    args[key] !== undefined ? String(args[key]) : `{${key}}`,
  );
}

/** Minimal JSON Schema validation: required presence + primitive type checks. */
export function validateSchema(args: Record<string, unknown>, schema: JSONSchema): string[] {
  const errors: string[] = [];
  const required = (schema as { required?: string[] }).required ?? [];
  const props = (schema as { properties?: Record<string, JSONSchema> }).properties ?? {};
  for (const field of required) {
    if (args[field] === undefined || args[field] === null || args[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }
  for (const [field, value] of Object.entries(args)) {
    const def = props[field] as { type?: string } | undefined;
    if (!def?.type || value === undefined || value === null) continue;
    const t = def.type;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    if (t === 'integer' || t === 'number') {
      if (typeof value !== 'number') errors.push(`Field ${field} should be a ${t}`);
    } else if (t === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`Field ${field} should be boolean`);
    } else if (t === 'string') {
      if (typeof value !== 'string') errors.push(`Field ${field} should be a string`);
    } else if (t === 'array' && actual !== 'array') {
      errors.push(`Field ${field} should be an array`);
    }
  }
  return errors;
}

export function validateConstraints(
  args: Record<string, unknown>,
  constraints: ArgConstraint[],
): string[] {
  const errors: string[] = [];
  for (const c of constraints) {
    const v = args[c.field];
    if (v === undefined) continue;
    switch (c.type) {
      case 'max_value':
        if (typeof v === 'number' && v > c.max) errors.push(`${c.field} must be <= ${c.max}`);
        break;
      case 'min_value':
        if (typeof v === 'number' && v < c.min) errors.push(`${c.field} must be >= ${c.min}`);
        break;
      case 'allowed_values':
        if (!c.values.includes(String(v)))
          errors.push(`${c.field} must be one of ${c.values.join(', ')}`);
        break;
      case 'regex':
        if (!new RegExp(c.pattern).test(String(v)))
          errors.push(`${c.field} does not match required format`);
        break;
      case 'not_equal':
        if (v === c.value) errors.push(`${c.field} must not equal ${String(c.value)}`);
        break;
    }
  }
  return errors;
}

/** Redact configured audit fields before they hit a log line. */
export function redactPII(
  args: Record<string, unknown>,
  auditFields: string[],
): Record<string, unknown> {
  if (auditFields.length === 0) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = auditFields.includes(k) ? '***redacted***' : v;
  }
  return out;
}

export function extractAuditFields(
  result: unknown,
  auditFields: string[],
): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    out[k] = auditFields.includes(k) ? '***redacted***' : v;
  }
  return out;
}

function tierNote(tier: ActionTier): string {
  switch (tier) {
    case ActionTier.ReversibleWrite:
      return '\n\nNote: this action asks the user to confirm before executing.';
    case ActionTier.StateUpdate:
      return '\n\nNote: this action modifies account state and shows the user a summary before executing.';
    case ActionTier.Destructive:
      return '\n\nNote: this is a sensitive action. The user must re-verify their identity before it executes.';
    default:
      return '';
  }
}

/** Build an LLM tool definition from an exposed action, with a tier warning. */
export function actionToTool(action: ActionDefinition): LLMTool {
  let description = action.description + tierNote(action.tier);
  if (action.rateLimitPerUserPerHour > 0) {
    description += ` (Rate limited to ${action.rateLimitPerUserPerHour} uses per hour.)`;
  }
  return {
    name: action.key,
    description,
    inputSchema: action.inputSchema,
  };
}
