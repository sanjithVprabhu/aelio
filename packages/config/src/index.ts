/**
 * Environment config loader + validator. The single place `process.env` is
 * read. Required fields fail fast with a human-readable list of what's missing.
 *
 * Design note: in this build almost everything is OPTIONAL so the platform runs
 * with zero infrastructure (in-memory persistence + scripted LLM). Set the
 * corresponding vars to opt into the real Postgres / Redis / Anthropic paths.
 */

export interface Config {
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  APP_NAME: string;
  PORT: number;
  BASE_URL: string;

  DATABASE_URL?: string;
  REDIS_URL?: string;

  /** 64+ hex chars (32 bytes) — required, but auto-generated in dev/test. */
  MASTER_ENCRYPTION_KEY: string;
  INTERNAL_SERVICE_SECRET: string;

  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';

  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** Preferred Google Gemini key (also accepts legacy GOOGLE_AI_API_KEY). */
  GEMINI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  EMBEDDING_PROVIDER?: 'hash' | 'openai' | 'google' | 'gemini';
  EMBEDDING_MODEL?: string;

  /** When unset, the platform uses the deterministic scripted LLM provider. */
  LLM_PROVIDER: 'anthropic' | 'openai' | 'google' | 'scripted';
  LLM_MODEL: string;
}

interface FieldSpec {
  required: boolean;
  /** Static default, or a resolver computed from the env being loaded. */
  default?: string | ((env: NodeJS.ProcessEnv) => string | undefined);
  parse?: (v: string) => unknown;
  validate?: (v: unknown) => string | null; // returns error message or null
}

const DEV_MASTER_KEY = 'a'.repeat(64); // dev/test only — never used in staging/prod
const DEV_SERVICE_SECRET = 's'.repeat(48);

function isDevLike(env: NodeJS.ProcessEnv): boolean {
  const node = env.NODE_ENV ?? 'development';
  return node === 'development' || node === 'test';
}

const SPEC: Record<keyof Config, FieldSpec> = {
  NODE_ENV: {
    required: false,
    default: 'development',
    validate: (v) =>
      ['development', 'test', 'staging', 'production'].includes(v as string)
        ? null
        : 'must be development|test|staging|production',
  },
  APP_NAME: { required: false, default: 'aelio' },
  PORT: { required: false, default: '3000', parse: (v) => Number(v) },
  BASE_URL: { required: false, default: 'http://localhost:3000' },
  DATABASE_URL: { required: false },
  REDIS_URL: { required: false },
  MASTER_ENCRYPTION_KEY: {
    required: false,
    default: (env) => (isDevLike(env) ? DEV_MASTER_KEY : undefined),
    validate: (v) => (String(v).length >= 64 ? null : 'must be >= 64 chars'),
  },
  INTERNAL_SERVICE_SECRET: {
    required: false,
    default: (env) => (isDevLike(env) ? DEV_SERVICE_SECRET : undefined),
    validate: (v) => (String(v).length >= 32 ? null : 'must be >= 32 chars'),
  },
  LOG_LEVEL: {
    required: false,
    default: 'info',
    validate: (v) =>
      ['debug', 'info', 'warn', 'error'].includes(v as string) ? null : 'invalid level',
  },
  ANTHROPIC_API_KEY: { required: false },
  OPENAI_API_KEY: { required: false },
  GEMINI_API_KEY: { required: false },
  GOOGLE_AI_API_KEY: { required: false },
  EMBEDDING_PROVIDER: { required: false },
  EMBEDDING_MODEL: { required: false },
  LLM_PROVIDER: {
    required: false,
    // Default to a real provider only if a key is present, else scripted.
    default: (env) => {
      if (env.LLM_PROVIDER) return env.LLM_PROVIDER;
      if (env.ANTHROPIC_API_KEY) return 'anthropic';
      if (env.OPENAI_API_KEY) return 'openai';
      if (env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY) return 'google';
      return 'scripted';
    },
    validate: (v) =>
      ['anthropic', 'openai', 'google', 'scripted'].includes(v as string)
        ? null
        : 'invalid provider',
  },
  LLM_MODEL: {
    required: false,
    default: (env) => {
      if (env.LLM_MODEL) return env.LLM_MODEL;
      if (env.LLM_PROVIDER === 'openai' || env.OPENAI_API_KEY) return 'gpt-4o';
      if (env.LLM_PROVIDER === 'google' || env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY) {
        return 'gemini-2.5-flash';
      }
      return 'claude-sonnet-4-6';
    },
  },
};

function resolve(env: NodeJS.ProcessEnv): { out: Record<string, unknown>; errors: string[] } {
  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, spec] of Object.entries(SPEC) as [keyof Config, FieldSpec][]) {
    const fallback = typeof spec.default === 'function' ? spec.default(env) : spec.default;
    const raw = env[key] ?? fallback;
    if (raw === undefined) {
      if (spec.required) errors.push(`${key}: required but missing`);
      continue;
    }
    const value = spec.parse ? spec.parse(raw) : raw;
    if (spec.validate) {
      const err = spec.validate(value);
      if (err) errors.push(`${key}: ${err}`);
    }
    out[key] = value;
  }
  return { out, errors };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { out, errors } = resolve(env);
  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  return out as unknown as Config;
}

/** Test-friendly variant that returns errors instead of exiting. */
export function parseConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const { out, errors } = resolve(env);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: out as unknown as Config };
}
