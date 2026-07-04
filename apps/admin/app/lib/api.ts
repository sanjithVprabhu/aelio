'use client';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
export const TENANT = 'acme';
const TOKEN_KEY = 'aelio_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window !== 'undefined') window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  if (typeof window !== 'undefined') window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Opts = { method?: string; body?: unknown; auth?: boolean; raw?: boolean };

/** Low-level fetch against the API base. `path` is appended to API_BASE. */
export async function apiRaw<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) {
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e: any) {
    throw new ApiError(
      `Cannot reach the API at ${API_BASE}. Is it running?`,
      0
    );
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      `Request failed (${res.status})`;
    throw new ApiError(Array.isArray(msg) ? msg.join(', ') : String(msg), res.status);
  }
  return data as T;
}

/** Tenant-scoped admin call: prefixes /api/v1/t/acme. */
export function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  return apiRaw<T>(`/api/v1/t/${TENANT}${path}`, opts);
}

/* ── Auth ── */
export function login(email: string, password: string) {
  return apiRaw<{ token: string; user: any }>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}
export function signup(email: string, password: string, name: string) {
  return apiRaw<{ token: string; user: any }>('/api/v1/auth/signup', {
    method: 'POST',
    body: { email, password, name },
    auth: false,
  });
}
export function me() {
  return apiRaw<any>('/api/v1/auth/me');
}

/* ── Live chat ── */
export type ChatReply = {
  kind: 'text' | 'magic_link' | 'step_up' | 'handoff';
  text: string;
  url?: string;
};
export type ChatResponse = {
  replies: ChatReply[];
  state: string;
  stateChanged?: boolean;
  confidence?: number;
  actions?: string[];
  needsVerification?: boolean;
  escalated?: boolean;
};
export function chatMessage(sessionId: string, text: string) {
  return apiRaw<ChatResponse>(`/api/v1/chat/${TENANT}/message`, {
    method: 'POST',
    body: { sessionId, text },
    auth: false,
  });
}
export function devFollow(url: string) {
  return apiRaw<any>('/api/v1/dev/follow', { method: 'POST', body: { url }, auth: false });
}
