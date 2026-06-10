import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { ChannelType } from '@aelio/types';
import { MockOutboundProvider, verifyMetaSignature, verifySlackSignature } from './providers.js';

describe('channel-worker signature verification', () => {
  it('verifies a valid Meta X-Hub-Signature-256 and rejects a bad one', () => {
    const secret = 'app_secret';
    const body = '{"entry":[]}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaSignature(sig, body, secret)).toBe(true);
    expect(verifyMetaSignature('sha256=deadbeef', body, secret)).toBe(false);
    expect(verifyMetaSignature(undefined, body, secret)).toBe(false);
  });

  it('verifies a valid Slack v0 signature', () => {
    const secret = 'slack_secret';
    const ts = '1700000000';
    const body = 'payload=1';
    const sig = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
    expect(verifySlackSignature(sig, ts, body, secret)).toBe(true);
    expect(verifySlackSignature('v0=bad', ts, body, secret)).toBe(false);
  });

  it('accepts when no secret is configured (dev mode)', () => {
    expect(verifyMetaSignature(undefined, 'x', '')).toBe(true);
  });

  it('records every delivered reply', async () => {
    const p = new MockOutboundProvider(ChannelType.WhatsApp);
    await p.deliver('+15551112222', [{ kind: 'text', text: 'hi' }, { kind: 'magic_link', text: 'verify', url: 'u' }]);
    expect(p.delivered).toHaveLength(2);
    expect(p.delivered[0]!.to).toBe('+15551112222');
  });
});
