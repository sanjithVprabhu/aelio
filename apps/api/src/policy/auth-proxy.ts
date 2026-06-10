import { decryptSync, type EncryptedValue } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import type { ActionDefinition, EndUserIdentity } from '@aelio/types';
import type { Store } from '../store/store.js';
import type { MockSaaS } from './mock-saas.js';

/**
 * The auth proxy — the heart of the capability moat. Every call to a tenant's
 * SaaS API goes through here, and it ALWAYS uses the end user's own scoped
 * token (decrypted per call), never a platform master key. The platform cannot
 * act outside what that user is already allowed to do.
 */
export class AuthProxy {
  constructor(
    private readonly store: Store,
    private readonly mockSaaS: MockSaaS,
  ) {}

  async call(
    tenantId: string,
    identity: EndUserIdentity,
    action: ActionDefinition,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!identity.encryptedAccessToken) {
      throw Errors.unauthorized('No access token on file. Re-verification required.');
    }
    // Possession check: decrypt the user's scoped token.
    let token: string;
    try {
      const enc = JSON.parse(identity.encryptedAccessToken) as EncryptedValue;
      token = decryptSync(enc);
    } catch {
      throw Errors.unauthorized('Stored access token is unreadable.');
    }

    const tenant = this.store.getTenant(tenantId);
    const baseUrl = action.baseUrl || tenant?.apiBaseUrl || '';

    // Demo backend: route mock:// base URLs to the in-process SaaS.
    if (baseUrl.startsWith('mock://') || !baseUrl) {
      return this.mockSaaS.call(identity.externalUserId, action.key, args);
    }

    // Real SaaS: HTTP with the user's bearer token, path/query/body routing.
    const { url, method, body } = this.buildRequest(action, args, baseUrl);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Platform-Request-Id': crypto.randomUUID(),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw Errors.saasApiError(504, err instanceof Error ? err.message : 'timeout', action.key);
    }
    if (!res.ok) {
      const text = await res.text();
      throw Errors.saasApiError(res.status, text, action.key);
    }
    return res.json();
  }

  private buildRequest(
    action: ActionDefinition,
    args: Record<string, unknown>,
    baseUrl: string,
  ): { url: string; method: string; body?: string } {
    let path = action.path ?? '';
    const query: Record<string, string> = {};
    let body: Record<string, unknown> | undefined;
    const method = (action.httpMethod ?? 'POST').toUpperCase();

    for (const [k, v] of Object.entries(args)) {
      if (path.includes(`{${k}}`)) {
        path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
      } else if (method === 'GET' || method === 'DELETE') {
        query[k] = String(v);
      } else {
        body = body ?? {};
        body[k] = v;
      }
    }

    const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    return {
      url: url.toString(),
      method,
      body: body ? JSON.stringify(body) : undefined,
    };
  }
}
