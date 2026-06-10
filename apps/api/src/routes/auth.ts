import type { FastifyInstance } from 'fastify';
import { AppError, Errors } from '@aelio/errors';
import type { Container } from '../container.js';
import { AuthService } from '../auth/auth-service.js';

/**
 * Admin authentication routes + an OPT-IN route guard. When ADMIN_AUTH_REQUIRED
 * is true, the tenant-scoped admin API requires a valid admin bearer token; by
 * default it is open (so the offline demo and tests run without auth). The admin
 * app always logs in and sends the token regardless.
 */
export function registerAuthRoutes(app: FastifyInstance, c: Container): void {
  const auth = new AuthService(c.store);
  const required = process.env.ADMIN_AUTH_REQUIRED === 'true';

  app.post<{ Body: { email: string; password: string; name: string; tenantSlug?: string } }>(
    '/api/v1/auth/signup',
    async (req, reply) => {
      const tenant = req.body.tenantSlug
        ? c.store.getTenantBySlug(req.body.tenantSlug)
        : c.store.getTenantBySlug(c.demoTenantSlug);
      if (!tenant) throw Errors.notFound('Tenant', req.body.tenantSlug ?? '');
      // First user on a tenant becomes owner.
      const role = c.store.listAdminUsers(tenant.id).length === 0 ? 'owner' : 'member';
      const out = auth.signup({ ...req.body, tenantId: tenant.id, role });
      reply.code(201);
      return out;
    },
  );

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', async (req) => {
    return auth.login(req.body.email, req.body.password);
  });

  app.get('/api/v1/auth/me', async (req) => {
    return auth.authenticate(req.headers.authorization);
  });

  if (required) {
    app.addHook('preHandler', async (req, reply) => {
      // Guard the admin surface; leave webhooks, chat, verify, auth, health open.
      const url = req.url;
      const guarded = url.startsWith('/api/v1/t/') || url.startsWith('/api/v1/tenants');
      if (!guarded) return;
      try {
        const user = auth.authenticate(req.headers.authorization);
        (req as { authUser?: unknown }).authUser = user;
      } catch (err) {
        const e = err instanceof AppError ? err : Errors.unauthorized();
        reply.code(e.statusCode).send(e.toJSON());
      }
    });
  }
}
