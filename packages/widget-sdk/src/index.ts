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
  /**
   * Optional pre-signed identity token or async provider. When supplied, the
   * widget will bind the visitor session to a trusted customer identity before
   * sending messages.
   */
  identityToken?: string;
  identityTokenProvider?: (sessionId: string) => string | null | Promise<string | null>;
  /** Optional accent color (hex/CSS color). Defaults to brand black. */
  accentColor?: string;
  /** Optional panel header title. Defaults to the brand wordmark. */
  widgetName?: string;
  /** Optional launcher label. Defaults to `"Chat"`. */
  launcherText?: string;
  /** Optional selector or element to mount into instead of `document.body`. */
  container?: string | HTMLElement;
  /** Optional inline mode for embedded harnesses rather than floating launchers. */
  inline?: boolean;
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

/** Guided objective progress returned with Convox phase state. */
export interface ObjectiveStatus {
  key: string;
  description: string;
  completed: boolean;
}

/** Persisted Convox phase snapshot from the runtime. */
export interface ConvoxPhase {
  currentState: string;
  confidence: number;
  reason?: string;
  completedObjectives: string[];
}

/** Shape of the JSON response returned by the chat API. */
export interface ChatResponse {
  replies: Reply[];
  state: string;
  actions: string[];
  needsVerification: boolean;
  convoxPhase?: ConvoxPhase;
  objectives?: ObjectiveStatus[];
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

/** Build the guided objectives strip shown under the header when states are active. */
export function renderObjectivesHtml(objectives: ObjectiveStatus[]): string {
  if (!objectives.length) return '';
  const items = objectives
    .map((o) => {
      const mark = o.completed ? '✓' : '○';
      const cls = o.completed ? 'objective done' : 'objective';
      return `<li class="${cls}"><span class="mark">${mark}</span><span class="label">${escapeHtml(o.description)}</span></li>`;
    })
    .join('');
  return `<ul class="objectives" aria-label="Guided objectives">${items}</ul>`;
}

/** Build the request body POSTed to the chat endpoint. */
export function buildMessageBody(sessionId: string, text: string): { sessionId: string; text: string } {
  return { sessionId, text };
}

/** Build the request body POSTed to the identity endpoint. */
export function buildIdentityBody(identityToken: string): { identityToken: string } {
  return { identityToken };
}

/**
 * Resolve `data-api` to an absolute API origin. Relative values like `.` or `/`
 * are resolved against the embedding page URL so `/customer-demo` still hits
 * the server root, not `/customer-demo/api/...`.
 */
export function resolveApiBase(apiBaseUrl: string, pageUrl?: string): string {
  const trimmed = apiBaseUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  if (pageUrl) {
    const href = new URL(pageUrl).href;
    const resolved = new URL(trimmed || '.', href).href.replace(/\/+$/, '');
    return resolved;
  }
  if (trimmed === '.' || trimmed === '' || trimmed === '/') return '';
  return trimmed.replace(/\/+$/, '');
}

/** Compose the chat message endpoint URL for a tenant. */
export function messageEndpoint(
  apiBaseUrl: string,
  tenantSlug: string,
  pageUrl?: string,
): string {
  const base = resolveApiBase(apiBaseUrl, pageUrl);
  const path = `/api/v1/chat/${encodeURIComponent(tenantSlug)}/message`;
  if (!base) return path;
  return `${base}${path}`;
}

/** Compose the chat identity endpoint URL for a tenant. */
export function identifyEndpoint(
  apiBaseUrl: string,
  tenantSlug: string,
  pageUrl?: string,
): string {
  const base = resolveApiBase(apiBaseUrl, pageUrl);
  const path = `/api/v1/chat/${encodeURIComponent(tenantSlug)}/identify`;
  if (!base) return path;
  return `${base}${path}`;
}

function parseObjectives(raw: unknown): ObjectiveStatus[] {
  if (!Array.isArray(raw)) return [];
  const out: ObjectiveStatus[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.key !== 'string' || typeof o.description !== 'string') continue;
    out.push({
      key: o.key,
      description: o.description,
      completed: o.completed === true,
    });
  }
  return out;
}

function parseConvoxPhase(raw: unknown): ConvoxPhase | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.currentState !== 'string') return undefined;
  return {
    currentState: p.currentState,
    confidence: typeof p.confidence === 'number' ? p.confidence : 0.5,
    reason: typeof p.reason === 'string' ? p.reason : undefined,
    completedObjectives: Array.isArray(p.completedObjectives)
      ? p.completedObjectives.filter((x): x is string => typeof x === 'string')
      : [],
  };
}

function parseActionKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') keys.push(item);
    else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).key === 'string') {
      keys.push((item as Record<string, unknown>).key as string);
    }
  }
  return keys;
}

/** Normalize a raw API payload into a strongly-typed {@link ChatResponse}. */
export function normalizeChatResponse(raw: unknown): ChatResponse {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawReplies = Array.isArray(obj['replies']) ? (obj['replies'] as unknown[]) : [];
  const replies = rawReplies.map(classifyReply);
  const state = typeof obj['state'] === 'string' ? (obj['state'] as string) : '';
  const actions = parseActionKeys(obj['actions']);
  const needsVerification = obj['needsVerification'] === true;
  const convoxPhase = parseConvoxPhase(obj['convoxPhase']);
  const objectives = parseObjectives(obj['objectives']);
  return { replies, state, actions, needsVerification, convoxPhase, objectives };
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
.root.inline {
  position: absolute; inset: 24px;
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
.root.inline .panel {
  display: flex;
  width: 100%; max-width: none; height: 100%; max-height: none;
}
.root.inline .launcher { display: none; }
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
.objectives-wrap {
  background: ${TOKENS.cream}; border-bottom: 1px solid rgba(10,10,10,0.08);
  padding: 8px 12px 10px;
}
.objectives {
  list-style: none; margin: 0; padding: 0; display: grid; gap: 4px;
}
.objective {
  display: grid; grid-template-columns: 16px 1fr; gap: 8px; align-items: start;
  font-size: 11px; line-height: 1.35; color: ${TOKENS.black};
}
.objective.done { opacity: 0.55; }
.objective .mark { font-size: 10px; font-weight: 700; color: ${accent}; }
.objective .label { color: ${TOKENS.black}; }
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
    identityToken: config.identityToken ?? '',
    identityTokenProvider: config.identityTokenProvider ?? (() => null),
    accentColor: config.accentColor ?? DEFAULT_ACCENT,
    widgetName: config.widgetName ?? TOKENS.wordmark,
    launcherText: config.launcherText ?? 'Chat',
    container: config.container ?? '',
    inline: config.inline ?? false,
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
  private objectivesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private mounted = false;
  private identified = false;
  private identifyPromise: Promise<void> | null = null;

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

  /** Bind the current visitor session to a signed customer identity token. */
  async identify(identityToken: string): Promise<void> {
    const token = identityToken.trim();
    if (!token) throw new Error('[aelio] identity token is required');
    if (this.identified) return;
    if (this.identifyPromise) return this.identifyPromise;
    this.identifyPromise = this.postIdentity(token)
      .then(() => {
        this.identified = true;
      })
      .finally(() => {
        this.identifyPromise = null;
      });
    return this.identifyPromise;
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
    rootEl.className = this.config.inline ? 'root inline open' : 'root';
    rootEl.innerHTML = this.shellHtml();
    root.appendChild(rootEl);

    const mountParent = this.resolveMountParent();
    mountParent.appendChild(host);

    this.host = host;
    this.root = root;
    this.rootEl = rootEl;
    this.messagesEl = root.querySelector('.messages');
    this.stateChipEl = root.querySelector('.header-right');
    this.objectivesEl = root.querySelector('.objectives-wrap');
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
  <div class="objectives-wrap" hidden></div>
  <div class="messages" aria-live="polite"></div>
  <div class="brand">Powered by ${escapeHtml(TOKENS.wordmark)}</div>
  <form class="composer">
    <input type="text" placeholder="Type a message…" autocomplete="off" />
    <button type="submit">Send</button>
  </form>
</div>`.trim();
  }

  private resolveMountParent(): HTMLElement {
    const container = this.config.container;
    if (container instanceof HTMLElement) return container;
    if (typeof container === 'string' && container) {
      const found = document.querySelector(container);
      if (found instanceof HTMLElement) return found;
    }
    if (document.body) return document.body;
    return document.documentElement as HTMLElement;
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
      await this.ensureIdentity();
      const res = await this.postMessage(text);
      this.updateStateChip(res.state);
      this.updateObjectives(res.objectives ?? []);
      for (const reply of res.replies) this.appendMessage('bot', reply);
      if (res.replies.length === 0) {
        this.appendMessage('bot', { kind: 'text', text: '…' });
      }
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message.replace(/^\[aelio\]\s*/, '')
          : 'request failed';
      this.appendMessage('bot', {
        kind: 'text',
        text: `Sorry, ${detail}. Please try again or contact support if the problem continues.`,
      });
    } finally {
      this.setBusy(false);
    }
  }

  private async ensureIdentity(): Promise<void> {
    if (this.identified) return;
    const inlineToken = this.config.identityToken.trim();
    if (inlineToken) {
      await this.identify(inlineToken);
      return;
    }
    const provided = await this.config.identityTokenProvider(this.sessionId);
    const token = typeof provided === 'string' ? provided.trim() : '';
    if (!token) return;
    await this.identify(token);
  }

  private async postIdentity(identityToken: string): Promise<void> {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : undefined;
    const url = identifyEndpoint(this.config.apiBaseUrl, this.config.tenantSlug, pageUrl);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildIdentityBody(identityToken)),
    });
    if (!response.ok) throw new Error(`[aelio] identity request failed: ${response.status}`);
  }

  private async postMessage(text: string): Promise<ChatResponse> {
    const pageUrl = typeof window !== 'undefined' ? window.location.href : undefined;
    const url = messageEndpoint(this.config.apiBaseUrl, this.config.tenantSlug, pageUrl);
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

  private updateObjectives(objectives: ObjectiveStatus[]): void {
    if (!this.objectivesEl) return;
    if (!objectives.length) {
      this.objectivesEl.hidden = true;
      this.objectivesEl.innerHTML = '';
      return;
    }
    this.objectivesEl.hidden = false;
    this.objectivesEl.innerHTML = renderObjectivesHtml(objectives);
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
