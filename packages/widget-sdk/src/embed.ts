/**
 * @aelio/widget-sdk/embed
 *
 * Tiny IIFE bootstrap. A customer drops one script tag onto their page:
 *
 * ```html
 * <script
 *   src="https://cdn.aelio.com/aelio-widget.js"
 *   data-tenant="acme"
 *   data-api="https://api.aelio.com"
 *   data-accent="#0A0A0A"
 *   data-name="Acme Support"
 *   data-launcher="Chat with us"
 * ></script>
 * ```
 *
 * It reads configuration from the script tag's `data-*` attributes and
 * auto-initializes the widget. `data-tenant` and `data-api` are required.
 */

import { initAelio, type AelioConfig, type AelioWidget } from './index.js';

/** Augment the global window so embedders can reach the live instance. */
declare global {
  interface Window {
    /** The mounted widget instance (set after bootstrap). */
    AelioWidget?: AelioWidget;
    /** Programmatic init, for embedders that prefer JS over data-attributes. */
    initAelio?: typeof initAelio;
  }
}

/** Locate the script element that loaded this bundle. */
function findOwnScript(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  // `document.currentScript` is set while the script executes synchronously.
  const current = document.currentScript;
  if (current && current instanceof HTMLScriptElement) return current;
  // Fallback: the last script that has a data-tenant attribute, or simply the
  // last script on the page (deferred/async execution path).
  const scripts = Array.from(document.getElementsByTagName('script'));
  const tagged = scripts.filter((s) => s.getAttribute('data-tenant'));
  if (tagged.length > 0) return tagged[tagged.length - 1] ?? null;
  return scripts.length > 0 ? (scripts[scripts.length - 1] ?? null) : null;
}

/** Build an {@link AelioConfig} from a script element's data-* attributes. */
export function configFromScript(script: HTMLScriptElement | null): AelioConfig | null {
  if (!script) return null;
  const tenantSlug = script.getAttribute('data-tenant')?.trim() ?? '';
  const apiBaseUrl = script.getAttribute('data-api')?.trim() ?? '';
  if (!tenantSlug || !apiBaseUrl) return null;
  const config: AelioConfig = { tenantSlug, apiBaseUrl };
  const accent = script.getAttribute('data-accent')?.trim();
  const name = script.getAttribute('data-name')?.trim();
  const launcher = script.getAttribute('data-launcher')?.trim();
  if (accent) config.accentColor = accent;
  if (name) config.widgetName = name;
  if (launcher) config.launcherText = launcher;
  return config;
}

/** Bootstrap the widget from the current script tag. Idempotent-ish. */
function bootstrap(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Always expose the programmatic factory.
  window.initAelio = initAelio;
  const config = configFromScript(findOwnScript());
  if (!config) {
    // No data-attributes — embedder will call window.initAelio(...) manually.
    return;
  }
  const start = (): void => {
    if (window.AelioWidget) return; // avoid double-mount
    window.AelioWidget = initAelio(config);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

bootstrap();
