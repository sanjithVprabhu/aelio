import { describe, it, expect, beforeEach } from 'vitest';
import { AppError } from '@aelio/errors';
import { Store } from '../store/store.js';
import { AuthService } from './auth-service.js';

describe('AuthService', () => {
  let store: Store;
  let auth: AuthService;
  const tenantId = 't1';

  beforeEach(() => {
    store = new Store();
    auth = new AuthService(store);
  });

  it('signs up, then authenticates with the issued token', () => {
    const { token, user } = auth.signup({
      email: 'a@b.com',
      password: 'secret123',
      name: 'A',
      tenantId,
      role: 'owner',
    });
    expect(user.role).toBe('owner');
    const authed = auth.authenticate(`Bearer ${token}`);
    expect(authed.email).toBe('a@b.com');
    expect(authed.id).toBe(user.id);
  });

  it('logs in with correct credentials and rejects wrong ones', () => {
    auth.signup({ email: 'c@d.com', password: 'pw', name: 'C', tenantId });
    expect(auth.login('c@d.com', 'pw').token).toBeTruthy();
    expect(() => auth.login('c@d.com', 'nope')).toThrow(AppError);
  });

  it('rejects a missing or non-admin token', () => {
    expect(() => auth.authenticate(undefined)).toThrow(AppError);
    expect(() => auth.authenticate('Bearer garbage')).toThrow(AppError);
  });

  it('prevents duplicate signups for the same email', () => {
    auth.signup({ email: 'dup@x.com', password: 'pw', name: 'D', tenantId });
    expect(() => auth.signup({ email: 'dup@x.com', password: 'pw', name: 'D2', tenantId })).toThrow(AppError);
  });
});
