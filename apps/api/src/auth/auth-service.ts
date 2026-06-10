import { hashPassword, signToken, verifyPassword, verifyToken, type TokenPayload } from '@aelio/crypto';
import { Errors } from '@aelio/errors';
import type { Store, AdminUserRecord } from '../store/store.js';
import { uuid } from '../util/id.js';

const TOKEN_TTL_S = 7 * 24 * 60 * 60;

export interface AuthedUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

/** Admin authentication: scrypt-hashed passwords, JWT (HMAC) sessions. */
export class AuthService {
  constructor(private readonly store: Store) {}

  signup(input: {
    email: string;
    password: string;
    name: string;
    tenantId: string;
    role?: 'owner' | 'admin' | 'member';
  }): { token: string; user: AuthedUser } {
    if (this.store.getAdminUserByEmail(input.email)) {
      throw Errors.conflict('An account with that email already exists.');
    }
    const record: AdminUserRecord = {
      id: uuid(),
      tenantId: input.tenantId,
      email: input.email,
      name: input.name,
      role: input.role ?? 'member',
      passwordHash: hashPassword(input.password),
      createdAt: new Date(),
    };
    this.store.putAdminUser(record);
    return { token: this.issue(record), user: this.toUser(record) };
  }

  login(email: string, password: string): { token: string; user: AuthedUser } {
    const record = this.store.getAdminUserByEmail(email);
    if (!record || !verifyPassword(password, record.passwordHash)) {
      throw Errors.unauthorized('Invalid email or password.');
    }
    return { token: this.issue(record), user: this.toUser(record) };
  }

  /** Verify a bearer token and return the user, or throw. */
  authenticate(authorization: string | undefined): AuthedUser {
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw Errors.unauthorized('Missing bearer token.');
    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch {
      throw Errors.unauthorized('Invalid or expired token.');
    }
    if (payload.purpose !== 'admin') throw Errors.unauthorized('Wrong token purpose.');
    const record = this.store.getAdminUser(payload.endUserId);
    if (!record) throw Errors.unauthorized('Unknown account.');
    return this.toUser(record);
  }

  private issue(record: AdminUserRecord): string {
    return signToken(
      { tenantId: record.tenantId, endUserId: record.id, purpose: 'admin' },
      TOKEN_TTL_S,
    );
  }

  private toUser(r: AdminUserRecord): AuthedUser {
    return { id: r.id, tenantId: r.tenantId, email: r.email, name: r.name, role: r.role };
  }
}
