'use client';

// Browser-side fetch helper for the interactive admin surfaces. Sends a Bearer
// token from localStorage when present and normalizes errors. The server-side
// read client in api.ts is untouched.

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

export const TENANT_SLUG = 'acme';

export const TOKEN_KEY = 'aelio_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function tenantPath(suffix: string): string {
  return `/api/v1/t/${TENANT_SLUG}${suffix}`;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? `Network error: ${err.message}` : 'API offline',
      0,
    );
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) ||
      (data && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : null) ||
      `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
};

// Convenience wrappers that already prefix the tenant path.
export const tapi = {
  get: <T>(suffix: string) => api.get<T>(tenantPath(suffix)),
  post: <T>(suffix: string, body?: unknown) => api.post<T>(tenantPath(suffix), body),
  patch: <T>(suffix: string, body?: unknown) => api.patch<T>(tenantPath(suffix), body),
  put: <T>(suffix: string, body?: unknown) => api.put<T>(tenantPath(suffix), body),
  del: <T>(suffix: string) => api.del<T>(tenantPath(suffix)),
};

// ---- Auth ----

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: string;
};

export type AuthResponse = { token: string; user: AuthUser };

export function login(email: string, password: string): Promise<AuthResponse> {
  return api.post<AuthResponse>('/api/v1/auth/login', { email, password });
}

export function signup(input: {
  email: string;
  password: string;
  name: string;
  tenantSlug?: string;
}): Promise<AuthResponse> {
  return api.post<AuthResponse>('/api/v1/auth/signup', input);
}

export function me(): Promise<AuthUser> {
  return api.get<AuthUser>('/api/v1/auth/me');
}
