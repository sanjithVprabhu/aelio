import { describe, it, expect } from 'vitest';
import {
  generateSessionId,
  isValidSessionId,
  sessionStorageKey,
  escapeHtml,
  classifyReply,
  replyHasAction,
  actionLabel,
  renderBubbleHtml,
  renderStateChipHtml,
  buildMessageBody,
  messageEndpoint,
  normalizeChatResponse,
  buildStylesheet,
  DEFAULT_ACCENT,
  TOKENS,
  type Reply,
} from './index.js';

describe('generateSessionId', () => {
  it('produces a prefixed, valid id', () => {
    const id = generateSessionId();
    expect(id.startsWith('aelio_sess_')).toBe(true);
    expect(isValidSessionId(id)).toBe(true);
  });

  it('falls back to deterministic id when crypto.randomUUID is absent', () => {
    // `globalThis.crypto` is a read-only getter in Node, so redefine the
    // property to force the fallback path, then restore it.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    try {
      Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
      const id = generateSessionId(
        () => 0.5,
        () => 1000,
      );
      expect(id.startsWith('aelio_sess_')).toBe(true);
      // 1000 -> base36, floor(0.5*1e9)=500000000 -> base36
      expect(id).toBe(`aelio_sess_${(1000).toString(36)}_${(500000000).toString(36)}`);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });
});

describe('isValidSessionId', () => {
  it('rejects non-strings and bad prefixes', () => {
    expect(isValidSessionId(null)).toBe(false);
    expect(isValidSessionId(123)).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('aelio_sess_')).toBe(false);
    expect(isValidSessionId('other_abc')).toBe(false);
    expect(isValidSessionId('aelio_sess_abc')).toBe(true);
  });
});

describe('sessionStorageKey', () => {
  it('is stable and namespaced', () => {
    expect(sessionStorageKey()).toBe('aelio:sessionId');
  });
});

describe('escapeHtml', () => {
  it('escapes all dangerous characters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
    );
  });
  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('classifyReply', () => {
  it('keeps known kinds', () => {
    expect(classifyReply({ kind: 'magic_link', text: 'hi', url: 'https://x' })).toEqual({
      kind: 'magic_link',
      text: 'hi',
      url: 'https://x',
    });
  });
  it('collapses unknown kinds to text', () => {
    expect(classifyReply({ kind: 'weird', text: 'yo' })).toEqual({ kind: 'text', text: 'yo' });
  });
  it('drops url for non-actionable kinds', () => {
    expect(classifyReply({ kind: 'text', text: 't', url: 'https://x' })).toEqual({
      kind: 'text',
      text: 't',
    });
    expect(classifyReply({ kind: 'handoff', text: 'h', url: 'https://x' })).toEqual({
      kind: 'handoff',
      text: 'h',
    });
  });
  it('handles missing/garbage input', () => {
    expect(classifyReply(null)).toEqual({ kind: 'text', text: '' });
    expect(classifyReply({})).toEqual({ kind: 'text', text: '' });
    expect(classifyReply({ kind: 42, text: 99 })).toEqual({ kind: 'text', text: '' });
  });
});

describe('replyHasAction / actionLabel', () => {
  it('flags actionable kinds', () => {
    expect(replyHasAction('magic_link')).toBe(true);
    expect(replyHasAction('step_up')).toBe(true);
    expect(replyHasAction('text')).toBe(false);
    expect(replyHasAction('handoff')).toBe(false);
  });
  it('labels each kind', () => {
    expect(actionLabel('magic_link')).toBe('Open secure link');
    expect(actionLabel('step_up')).toBe('Verify identity');
    expect(actionLabel('text')).toBe('Open');
  });
});

describe('renderBubbleHtml', () => {
  it('renders a user bubble with escaping', () => {
    const html = renderBubbleHtml('user', { kind: 'text', text: '<b>hi</b>' });
    expect(html).toBe('<div class="bubble user">&lt;b&gt;hi&lt;/b&gt;</div>');
  });
  it('renders a bot text bubble without an action', () => {
    const html = renderBubbleHtml('bot', { kind: 'text', text: 'hello' });
    expect(html).toContain('class="bubble bot"');
    expect(html).not.toContain('class="action"');
  });
  it('renders an action button for magic_link', () => {
    const reply: Reply = { kind: 'magic_link', text: 'Click', url: 'https://a.com/x?y=1&z=2' };
    const html = renderBubbleHtml('bot', reply);
    expect(html).toContain('class="action"');
    expect(html).toContain('data-kind="magic_link"');
    expect(html).toContain('href="https://a.com/x?y=1&amp;z=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Open secure link');
  });
  it('renders a step_up action button', () => {
    const html = renderBubbleHtml('bot', { kind: 'step_up', text: 'verify', url: 'https://v' });
    expect(html).toContain('Verify identity');
  });
  it('does not render an action when bot reply has no url', () => {
    const html = renderBubbleHtml('bot', { kind: 'magic_link', text: 'x' });
    expect(html).not.toContain('class="action"');
  });
  it('never renders an action for the user side', () => {
    const html = renderBubbleHtml('user', { kind: 'magic_link', text: 'x', url: 'https://x' });
    expect(html).not.toContain('class="action"');
  });
});

describe('renderStateChipHtml', () => {
  it('returns empty for empty state', () => {
    expect(renderStateChipHtml('')).toBe('');
  });
  it('renders an escaped chip', () => {
    expect(renderStateChipHtml('verifying')).toBe('<span class="state-chip">verifying</span>');
    expect(renderStateChipHtml('<x>')).toBe('<span class="state-chip">&lt;x&gt;</span>');
  });
});

describe('buildMessageBody', () => {
  it('builds the POST body', () => {
    expect(buildMessageBody('sess_1', 'hi')).toEqual({ sessionId: 'sess_1', text: 'hi' });
  });
});

describe('messageEndpoint', () => {
  it('composes the tenant-scoped path', () => {
    expect(messageEndpoint('https://api.aelio.com', 'acme')).toBe(
      'https://api.aelio.com/api/v1/chat/acme/message',
    );
  });
  it('strips trailing slashes from the base', () => {
    expect(messageEndpoint('https://api.aelio.com/', 'acme')).toBe(
      'https://api.aelio.com/api/v1/chat/acme/message',
    );
  });
  it('url-encodes the tenant slug', () => {
    expect(messageEndpoint('https://api.aelio.com', 'a b')).toBe(
      'https://api.aelio.com/api/v1/chat/a%20b/message',
    );
  });
});

describe('normalizeChatResponse', () => {
  it('normalizes a full payload', () => {
    const res = normalizeChatResponse({
      replies: [
        { kind: 'text', text: 'hi' },
        { kind: 'magic_link', text: 'link', url: 'https://x' },
      ],
      state: 'verifying',
      actions: ['resend', 42],
      needsVerification: true,
    });
    expect(res.replies).toHaveLength(2);
    expect(res.replies[1]).toEqual({ kind: 'magic_link', text: 'link', url: 'https://x' });
    expect(res.state).toBe('verifying');
    expect(res.actions).toEqual(['resend']);
    expect(res.needsVerification).toBe(true);
  });
  it('defaults missing fields safely', () => {
    const res = normalizeChatResponse(null);
    expect(res.replies).toEqual([]);
    expect(res.state).toBe('');
    expect(res.actions).toEqual([]);
    expect(res.needsVerification).toBe(false);
  });
});

describe('buildStylesheet', () => {
  it('inlines the accent and brand tokens', () => {
    const css = buildStylesheet('#123456');
    expect(css).toContain('#123456');
    expect(css).toContain(TOKENS.cream);
    expect(css).toContain('Hanken Grotesk');
    expect(css).toContain(':host');
  });
  it('uses brand black as the default accent', () => {
    expect(DEFAULT_ACCENT).toBe('#0A0A0A');
    expect(buildStylesheet(DEFAULT_ACCENT)).toContain('#0A0A0A');
  });
});
