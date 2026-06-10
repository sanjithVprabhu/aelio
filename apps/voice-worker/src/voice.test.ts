import { describe, it, expect } from 'vitest';
import { MockStt, MockTts, generateOtp, twimlGather, twimlHangup, twimlSayAndGather } from './voice.js';

describe('voice-worker helpers', () => {
  it('builds a TwiML Gather with the prompt and action', () => {
    const xml = twimlGather('acme', 'How can I help?');
    expect(xml).toContain('<Gather');
    expect(xml).toContain('action="/voice/handle/acme"');
    expect(xml).toContain('How can I help?');
  });

  it('escapes XML special characters in spoken text', () => {
    const xml = twimlSayAndGather('acme', "you're <set> & done", 'next?');
    expect(xml).toContain('&apos;');
    expect(xml).toContain('&lt;set&gt;');
    expect(xml).toContain('&amp;');
  });

  it('builds a hangup', () => {
    expect(twimlHangup('bye')).toContain('<Hangup/>');
  });

  it('generates a 6-digit OTP', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('mock STT/TTS pass text through', async () => {
    expect(await new MockStt().transcribe('  hello  ')).toBe('hello');
    expect(await new MockTts().synthesize('reply')).toBe('reply');
  });
});
