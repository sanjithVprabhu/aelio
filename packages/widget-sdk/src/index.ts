/**
 * @aelio/widget-sdk
 *
 * Embeddable, dependency-free web-chat widget for SaaS customers of Aelio.
 *
 * The widget renders an isolated chat launcher + panel inside a shadow DOM so
 * host-page styles can never leak in (or out). It manages a per-visitor
 * `sessionId` persisted in localStorage and talks to the Aelio chat API.
 *
 * Design notes
 * ------------
 * All DOM-independent logic (sessionId generation, reply classification,
 * HTML escaping, bubble/action markup) lives in pure exported functions so it
 * can be unit-tested without a DOM environment. The {@link AelioWidget} class
 * is a thin DOM shell that wires those pure helpers to the shadow root.
 */

/* -------------------------------------------------------------------------- */
/*  Design tokens                                                             */
/* -------------------------------------------------------------------------- */

/** Aelio brand design tokens. Kept here so the widget is fully self-contained. */
export const TOKENS = {
  wordmark: 'Aelio.',
  black: '#0A0A0A',
  cream: '#F5F0E8',
  white: '#FFFFFF',
  font: "'Hanken Grotesk', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
} as const;

/** Default accent used when the customer does not supply `accentColor`. */
export const DEFAULT_ACCENT = TOKENS.black;

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

/** Configuration accepted by {@link initAelio} / {@link AelioWidget}. */
export interface AelioConfig {
  /** Tenant slug, e.g. `"acme"`. Used to scope the chat API path. */
  tenantSlug: string;
  /** Base URL of the Aelio API, e.g. `"https://api.aelio.com"`. */
  apiBaseUrl: string;
  /** Optional accent color (hex/CSS color). Defaults to brand black. */
  accentColor?: string;
  /** Optional panel header title. Defaults to the brand wordmark. */
  widgetName?: string;
  /** Optional launcher label. Defaults to `"Chat"`. */
  launcherText?: string;
}

/** The kinds of reply the server can send back. */
export type ReplyKind = 'text' | 'magic_link' | 'step_up' | 'handoff';

/** A single reply item from the chat API. */
export interface Reply {
  kind: ReplyKind;
  text: string;
  /** Present for `magic_link` / `step_up` replies — the URL the button opens. */
  url?: string;
}

/** Shape of the JSON response returned by the chat API. */
export interface ChatResponse {
  replies: Reply[];
  state: string;
  actions: string[];
  needsVerification: boolean;
}

/** Which side of the conversation a bubble belongs to. */
export type Sender = 'user' | 'bot';

/* -------------------------------------------------------------------------- */
/*  Pure helpers (DOM-independent, unit-testable)                             */
/* -------------------------------------------------------------------------- */

const SESSION_STORAGE_KEY = 'aelio:sessionId';
const SESSION_PREFIX = 'aelio_sess_';
const VALID_KINDS: readonly ReplyKind[] = ['text', 'magic_link', 'step_up', 'handoff'];

/**
 * Generate a fresh, reasonably-unique visitor session id.
 *
 * Uses `crypto.randomUUID` when available (browsers, modern Node) and falls
 * back to a timestamp+random scheme so it works in any environment without a
 * DOM. The `random` and `now` parameters are injectable to keep this pure and
 * deterministically testable.
 */
export function generateSessionId(
  random: () => number = Math.random,
  now: () => number = Date.now,
): string {
  const cryptoObj: { randomUUID?: () => string } | undefined =
    typeof globalThis !== 'undefined'
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${SESSION_PREFIX}${cryptoObj.randomUUID()}`;
  }
  const rand = Math.floor(random() * 1e9).toString(36);
  const time = now().toString(36);
  return `${SESSION_PREFIX}${time}_${rand}`;
}

/**
 * Validate that a value looks like one of our session ids. Used when reading
 * back from localStorage where the value is untrusted.
 */
export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SESSION_PREFIX) && value.length > SESSION_PREFIX.length;
}

/** localStorage key under which the visitor session id is persisted. */
export function sessionStorageKey(): string {
  return SESSION_STORAGE_KEY;
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Classify an arbitrary reply object coming off the wire into a well-formed
 * {@link Reply}. Unknown kinds collapse to `'text'`, and action URLs are only
 * retained for kinds that render a button (`magic_link` / `step_up`).
 */
export function classifyReply(raw: unknown): Reply {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawKind = obj['kind'];
  const kind: ReplyKind = VALID_KINDS.includes(rawKind as ReplyKind) ? (rawKind as ReplyKind) : 'text';
  const text = typeof obj['text'] === 'string' ? (obj['text'] as string) : '';
  const url = typeof obj['url'] === 'string' ? (obj['url'] as string) : undefined;
  const reply: Reply = { kind, text };
  if (url && replyHasAction(kind)) reply.url = url;
  return reply;
}

/** True when a reply kind should render a clickable action button. */
export function replyHasAction(kind: ReplyKind): boolean {
  return kind === 'magic_link' || kind === 'step_up';
}

/** Human-readable label for the action button of an actionable reply. */
export function actionLabel(kind: ReplyKind): string {
  switch (kind) {
    case 'magic_link':
      return 'Open secure link';
    case 'step_up':
      return 'Verify identity';
    default:
      return 'Open';
  }
}

/**
 * Build the inner HTML for a chat bubble. Pure and DOM-free so it can be
 * snapshot-tested. The returned markup is inserted into a `.msg` row element
 * by the widget; it includes the bubble and, for actionable replies, a button.
 */
export function renderBubbleHtml(sender: Sender, reply: Reply): string {
  const safeText = escapeHtml(reply.text);
  const bubble = `<div class="bubble ${sender === 'user' ? 'user' : 'bot'}">${safeText}</div>`;
  if (sender === 'bot' && replyHasAction(reply.kind) && reply.url) {
    const safeUrl = escapeHtml(reply.url);
    const label = escapeHtml(actionLabel(reply.kind));
    return (
      bubble +
      `<a class="action" data-kind="${escapeHtml(reply.kind)}" href="${safeUrl}" ` +
      `target="_blank" rel="noopener noreferrer">${label}</a>`
    );
  }
  return bubble;
}

/** Build the HTML for the conversation state chip (e.g. "verifying"). */
export function renderStateChipHtml(state: string): string {
  if (!state) return '';
  return `<span class="state-chip">${escapeHtml(state)}</span>`;
}

/** Build the request body POSTed to the chat endpoint. */
export function buildMessageBody(sessionId: string, text: string): { sessionId: string; text: string } {
  return { sessionId, text };
}

/** Compose the chat message endpoint URL for a tenant. */
export function messageEndpoint(apiBaseUrl: string, tenantSlug: string): string {
  const base = apiBaseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/chat/${encodeURIComponent(tenantSlug)}/message`;
}

/** Normalize a raw API payload into a strongly-typed {@link ChatResponse}. */
export function normalizeChatResponse(raw: unknown): ChatResponse {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawReplies = Array.isArray(obj['replies']) ? (obj['replies'] as unknown[]) : [];
  const replies = rawReplies.map(classifyReply);
  const state = typeof obj['state'] === 'string' ? (obj['state'] as string) : '';
  const actions = Array.isArray(obj['actions'])
    ? (obj['actions'] as unknown[]).filter((a): a is string => typeof a === 'string')
    : [];
  const needsVerification = obj['needsVerification'] === true;
  return { replies, state, actions, needsVerification };
}

/* -------------------------------------------------------------------------- */
/*  Stylesheet                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Build the full CSS string for the shadow root, parameterized by accent.
 * Kept pure so it can be inspected/tested without a DOM.
 */
export function buildStylesheet(accent: string): string {
  return `
:host { all: initial; }
* { box-sizing: border-box; font-family: ${TOKENS.font}; }
.root {
  position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
  font-family: ${TOKENS.font};
}
.launcher {
  display: inline-flex; align-items: center; gap: 8px;
  background: ${accent}; color: ${TOKENS.white};
  border: none; border-radius: 999px; padding: 12px 20px;
  font-size: 15px; font-weight: 600; cursor: pointer;
  box-shadow: 0 6px 24px rgba(10,10,10,0.18);
}
.launcher:hover { filter: brightness(1.08); }
.panel {
  display: none; flex-direction: column;
  width: 360px; max-width: calc(100vw - 40px); height: 520px; max-height: calc(100vh - 120px);
  background: ${TOKENS.white}; border-radius: 16px; overflow: hidden;
  box-shadow: 0 12px 48px rgba(10,10,10,0.28); border: 1px solid ${TOKENS.cream};
}
.root.open .panel { display: flex; }
.root.open .launcher { display: none; }
.header {
  display: flex; align-items: center; justify-content: space-between;
  background: ${accent}; color: ${TOKENS.white}; padding: 14px 16px;
}
.title { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; }
.header-right { display: flex; align-items: center; gap: 8px; }
.state-chip {
  background: rgba(255,255,255,0.18); color: ${TOKENS.white};
  border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600;
  text-transform: capitalize;
}
.close { background: transparent; border: none; color: ${TOKENS.white}; cursor: pointer; font-size: 18px; line-height: 1; }
.messages { flex: 1; overflow-y: auto; padding: 16px; background: ${TOKENS.cream}; display: flex; flex-direction: column; gap: 10px; }
.msg { display: flex; flex-direction: column; max-width: 85%; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.bot { align-self: flex-start; align-items: flex-start; }
.bubble { padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
.bubble.user { background: ${accent}; color: ${TOKENS.white}; border-bottom-right-radius: 4px; }
.bubble.bot { background: ${TOKENS.white}; color: ${TOKENS.black}; border: 1px solid rgba(10,10,10,0.08); border-bottom-left-radius: 4px; }
.action {
  margin-top: 6px; display: inline-block; text-decoration: none;
  background: ${TOKENS.black}; color: ${TOKENS.white};
  border-radius: 10px; padding: 8px 14px; font-size: 13px; font-weight: 600;
}
.action:hover { filter: brightness(1.12); }
.composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid ${TOKENS.cream}; background: ${TOKENS.white}; }
.composer input {
  flex: 1; border: 1px solid rgba(10,10,10,0.15); border-radius: 10px;
  padding: 10px 12px; font-size: 14px; color: ${TOKENS.black}; outline: none;
}
.composer input:focus { border-color: ${accent}; }
.composer button {
  background: ${accent}; color: ${TOKENS.white}; border: none; border-radius: 10px;
  padding: 0 16px; font-weight: 600; cursor: pointer; font-size: 14px;
}
.composer button:disabled { opacity: 0.5; cursor: default; }
.brand { text-align: center; font-size: 10px; color: rgba(10,10,10,0.4); padding: 4px 0 8px; background: ${TOKENS.white}; }
`.trim();
}

/* -------------------------------------------------------------------------- */
/*  Minimal ambient DOM typings (guarded so typecheck never needs lib.dom)    */
/* -------------------------------------------------------------------------- */

// We compile this package with `lib: ["ES2022","DOM"]`, so DOM types are
// available. All DOM access is still feature-guarded at runtime so the module
// can be imported in a non-browser context (e.g. SSR or tests) without
// throwing on load.

/* -------------------------------------------------------------------------- */
/*  Widget                                                                    */
/* -------------------------------------------------------------------------- */

/** Resolve config with defaults applied. */
function resolveConfig(config: AelioConfig): Required<AelioConfig> {
  return {
    tenantSlug: config.tenantSlug,
    apiBaseUrl: config.apiBaseUrl,
    accentColor: config.accentColor ?? DEFAULT_ACCENT,
    widgetName: config.widgetName ?? TOKENS.wordmark,
    launcherText: config.launcherText ?? 'Chat',
  };
}

/**
 * The embeddable Aelio chat widget. Construct via {@link initAelio} (preferred)
 * or directly with `new AelioWidget(config)`. Calling the constructor mounts
 * the widget immediately when a DOM is present.
 */
export class AelioWidget {
  private readonly config: Required<AelioConfig>;
  private sessionId: string;
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private rootEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private stateChipEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private mounted = false;

  constructor(config: AelioConfig) {
    if (!config || !config.tenantSlug || !config.apiBaseUrl) {
      throw new Error('[aelio] initAelio requires { tenantSlug, apiBaseUrl }');
    }
    this.config = resolveConfig(config);
    this.sessionId = this.loadOrCreateSession();
    if (this.hasDom()) this.mount();
  }

  /** The current visitor session id (persisted across page loads). */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Open the chat panel. No-op if not mounted. */
  open(): void {
    this.rootEl?.classList.add('open');
    this.inputEl?.focus();
  }

  /** Close the chat panel. No-op if not mounted. */
  close(): void {
    this.rootEl?.classList.remove('open');
  }

  /** Toggle the chat panel open/closed. */
  toggle(): void {
    if (this.rootEl?.classList.contains('open')) this.close();
    else this.open();
  }

  /** Remove the widget from the page and release references. */
  destroy(): void {
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.root = null;
    this.rootEl = null;
    this.messagesEl = null;
    this.mounted = false;
  }

  /* ----------------------------- internals ------------------------------ */

  private hasDom(): boolean {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  }

  private loadOrCreateSession(): string {
    let existing: string | null = null;
    try {
      if (typeof localStorage !== 'undefined') {
        existing = localStorage.getItem(sessionStorageKey());
      }
    } catch {
      existing = null;
    }
    if (isValidSessionId(existing)) return existing;
    const fresh = generateSessionId();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(sessionStorageKey(), fresh);
      }
    } catch {
      /* storage may be unavailable (private mode); session stays in-memory */
    }
    return fresh;
  }

  private mount(): void {
    if (this.mounted) return;
    const host = document.createElement('div');
    host.setAttribute('data-aelio-widget', this.config.tenantSlug);
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = buildStylesheet(this.config.accentColor);
    root.appendChild(style);

    const rootEl = document.createElement('div');
    rootEl.className = 'root';
    rootEl.innerHTML = this.shellHtml();
    root.appendChild(rootEl);

    if (document.body) document.body.appendChild(host);
    else document.documentElement.appendChild(host);

    this.host = host;
    this.root = root;
    this.rootEl = rootEl;
    this.messagesEl = root.querySelector('.messages');
    this.stateChipEl = root.querySelector('.header-right');
    this.inputEl = root.querySelector('.composer input');
    this.sendBtn = root.querySelector('.composer button');

    this.wireEvents(root);
    this.mounted = true;
  }

  private shellHtml(): string {
    const { launcherText, widgetName } = this.config;
    return `
<button class="launcher" type="button" aria-label="Open chat">
  <span>${escapeHtml(launcherText)}</span>
</button>
<div class="panel" role="dialog" aria-label="${escapeHtml(widgetName)}">
  <div class="header">
    <span class="title">${escapeHtml(widgetName)}</span>
    <span class="header-right">
      <button class="close" type="button" aria-label="Close chat">&times;</button>
    </span>
  </div>
  <div class="messages" aria-live="polite"></div>
  <div class="brand">Powered by ${escapeHtml(TOKENS.wordmark)}</div>
  <form class="composer">
    <input type="text" placeholder="Type a message…" autocomplete="off" />
    <button type="submit">Send</button>
  </form>
</div>`.trim();
  }

  private wireEvents(root: ShadowRoot): void {
    root.querySelector('.launcher')?.addEventListener('click', () => this.open());
    root.querySelector('.close')?.addEventListener('click', () => this.close());
    const form = root.querySelector('.composer') as HTMLFormElement | null;
    form?.addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const text = this.inputEl?.value.trim() ?? '';
      if (text) void this.send(text);
    });
  }

  /** Send a user message and render the bot reply. Exposed for programmatic use. */
  async send(text: string): Promise<void> {
    this.appendMessage('user', { kind: 'text', text });
    if (this.inputEl) this.inputEl.value = '';
    this.setBusy(true);
    try {
      const res = await this.postMessage(text);
      this.updateStateChip(res.state);
      for (const reply of res.replies) this.appendMessage('bot', reply);
      if (res.replies.length === 0) {
        this.appendMessage('bot', { kind: 'text', text: '…' });
      }
    } catch {
      this.appendMessage('bot', {
        kind: 'text',
        text: 'Sorry — something went wrong. Please try again.',
      });
    } finally {
      this.setBusy(false);
    }
  }

  private async postMessage(text: string): Promise<ChatResponse> {
    const url = messageEndpoint(this.config.apiBaseUrl, this.config.tenantSlug);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildMessageBody(this.sessionId, text)),
    });
    if (!response.ok) throw new Error(`[aelio] chat request failed: ${response.status}`);
    const json: unknown = await response.json();
    return normalizeChatResponse(json);
  }

  private appendMessage(sender: Sender, reply: Reply): void {
    if (!this.messagesEl) return;
    const row = document.createElement('div');
    row.className = `msg ${sender}`;
    row.innerHTML = renderBubbleHtml(sender, reply);
    this.messagesEl.appendChild(row);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private updateStateChip(state: string): void {
    if (!this.stateChipEl) return;
    const existing = this.stateChipEl.querySelector('.state-chip');
    if (existing) existing.remove();
    if (!state) return;
    const close = this.stateChipEl.querySelector('.close');
    const tmp = document.createElement('div');
    tmp.innerHTML = renderStateChipHtml(state);
    const chip = tmp.firstElementChild;
    if (chip) this.stateChipEl.insertBefore(chip, close);
  }

  private setBusy(busy: boolean): void {
    if (this.sendBtn) this.sendBtn.disabled = busy;
    if (this.inputEl) this.inputEl.disabled = busy;
  }
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create and mount an Aelio chat widget. Preferred entry point.
 *
 * @example
 * ```ts
 * initAelio({ tenantSlug: 'acme', apiBaseUrl: 'https://api.aelio.com' });
 * ```
 */
export function initAelio(config: AelioConfig): AelioWidget {
  return new AelioWidget(config);
}

export default initAelio;
