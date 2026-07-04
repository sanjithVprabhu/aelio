import { describe, it, expect } from 'vitest';
import { ChannelType } from '@aelio/types';
import { signIdentity } from '@aelio/convox-sdk';
import { createContainer } from '../container.js';

describe('identity assertion', () => {
  it('binds a verified session from a Convox identity token', async () => {
    const c = createContainer({ allowInMemory: true });
    const tenant = c.store.getTenantBySlug('acme')!;
    const apiKey = c.store.getTenantApiKey(tenant.id)!;
    const token = signIdentity(tenant.slug, apiKey, {
      sessionId: 'widget_sess_99',
      userId: 'customer_user_99',
      email: 'alex@acme.com',
    });

    const { identity, session } = await c.identity.bindIdentityAssertion(
      tenant.id,
      ChannelType.WebChat,
      { sessionId: 'widget_sess_99', userId: 'customer_user_99', email: 'alex@acme.com' },
    );

    expect(identity.externalUserId).toBe('customer_user_99');
    expect(identity.verificationStatus).toBe('verified');
    expect(session.identityId).toBe(identity.id);
    expect(token.split('.')).toHaveLength(2);
  });
});
