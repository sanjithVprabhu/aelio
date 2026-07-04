import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { ServerRuntimeConfig } from '../runtime/server-config.js';

const SHELL = (title: string, body: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--black:#0A0A0A;--cream:#F5F0E8;--white:#fff;--ink-70:rgba(10,10,10,.66);--ink-45:rgba(10,10,10,.45);--hair:rgba(10,10,10,.12)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:var(--black);color:var(--cream);min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.55}
  a{color:inherit}
  .wrap{max-width:560px;margin:0 auto;padding:clamp(2rem,8vh,6rem) 1.5rem}
  .wordmark{font-weight:700;letter-spacing:-.01em;font-size:1.4rem}
  .card{background:var(--white);color:var(--black);border-radius:14px;padding:2.4rem;margin-top:2rem;box-shadow:0 20px 60px -30px rgba(0,0,0,.6)}
  .mark{width:46px;height:46px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:1.4rem;margin-bottom:1.4rem}
  .ok{background:#E7F7EC;color:#1e8c53}.bad{background:#2a1215;color:#ff8a80}
  h1{font-size:1.7rem;font-weight:800;letter-spacing:-.03em;margin-bottom:.6rem}
  p{color:var(--ink-70)}
  .btn{display:inline-flex;gap:.5em;align-items:center;margin-top:1.6rem;background:var(--black);color:var(--cream);padding:.8em 1.4em;border-radius:8px;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-family:inherit;font-size:1rem}
  .muted{color:var(--ink-45);font-size:.85rem;margin-top:1.4rem}
</style></head><body><div class="wrap"><div class="wordmark">Aelio<span>.</span></div>${body}</div></body></html>`;

function loadWidgetAsset(path: string, label: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${label} not found at ${path}. Run: pnpm --filter @aelio/widget-sdk build`,
    );
  }
  return readFileSync(path, 'utf8');
}

export function registerPageRoutes(
  app: FastifyInstance,
  c: Container,
  runtime: ServerRuntimeConfig,
): void {
  const widgetSdkJs = loadWidgetAsset(widgetSdkDistPath, 'widget-sdk index');
  const widgetSdkEmbedJs = loadWidgetAsset(widgetSdkEmbedDistPath, 'widget-sdk embed');

  app.get<{ Params: { token: string } }>('/verify/:token', async (_req, reply) => {
    reply.type('text/html');
    try {
      const { identity } = await c.identity.verifyMagicLink(_req.params.token);
      const name = String(identity.metadata.name ?? 'there');
      return SHELL(
        'Verified — Aelio',
        `<div class="card"><div class="mark ok">✓</div><h1>You're verified, ${name}.</h1>
         <p>Your identity is confirmed. You can head back to your conversation — Aelio can now act securely on your behalf.</p>
         <a class="btn" href="/chat">Back to chat →</a>
         <p class="muted">This link can only be used once.</p></div>`,
      );
    } catch {
      return SHELL(
        'Link expired — Aelio',
        `<div class="card"><div class="mark bad">!</div><h1>This link has expired.</h1>
         <p>Magic links are valid for 15 minutes and can only be used once. Ask Aelio to send a fresh one.</p>
         <a class="btn" href="/chat">Back to chat →</a></div>`,
      );
    }
  });

  app.get<{ Params: { token: string } }>('/step-up/:token', async (req, reply) => {
    reply.type('text/html');
    try {
      await c.identity.completeStepUp(req.params.token);
      return SHELL(
        'Re-verified — Aelio',
        `<div class="card"><div class="mark ok">✓</div><h1>Identity re-confirmed.</h1>
         <p>You're cleared for sensitive changes for the next 15 minutes. Return to your conversation to continue.</p>
         <a class="btn" href="/chat">Back to chat →</a></div>`,
      );
    } catch {
      return SHELL(
        'Step-up failed — Aelio',
        `<div class="card"><div class="mark bad">!</div><h1>Couldn't verify that.</h1>
         <p>The step-up link is invalid or expired. Ask Aelio to send a new one.</p>
         <a class="btn" href="/chat">Back to chat →</a></div>`,
      );
    }
  });

  // Live, API-backed chat widget against the real runtime.
  app.get('/chat', async (_req, reply) => {
    reply.type('text/html');
    return CUSTOMER_DEMO_PAGE(c.demoTenantSlug, runtime.customerBackendUrl);
  });

  if (runtime.enableDemoRoutes) {
    app.get('/demo/chat', async (_req, reply) => {
      reply.type('text/html');
      return CHAT_PAGE(c.demoTenantSlug);
    });

    // Postgres-persistent SaaS + chat — manual demo harness.
    app.get('/demo/live', async (_req, reply) => {
      reply.type('text/html');
      return DEMO_LIVE_PAGE(c.demoTenantSlug);
    });

    // Per-turn product telemetry — intent, state, flow, tools.
    app.get('/demo/telemetry', async (_req, reply) => {
      reply.type('text/html');
      return DEMO_TELEMETRY_PAGE(c.demoTenantSlug, runtime.customerBackendUrl);
    });

    app.get('/demo/customer', async (_req, reply) => {
      reply.type('text/html');
      return CUSTOMER_DEMO_PAGE(c.demoTenantSlug, runtime.customerBackendUrl);
    });
  }

  app.get('/customer-demo', async (_req, reply) => reply.redirect('/chat'));
  app.get('/demo-live', async (_req, reply) => reply.redirect('/demo/live'));
  app.get('/demo-telemetry', async (_req, reply) => reply.redirect('/demo/telemetry'));

  const sdkHeaders = (reply: { header: (k: string, v: string) => void }) => {
    reply.header('cache-control', 'no-store, must-revalidate');
  };

  app.get('/widget-sdk.js', async (_req, reply) => {
    sdkHeaders(reply);
    reply.type('text/javascript; charset=utf-8');
    return widgetSdkJs;
  });

  app.get('/widget-sdk-embed.js', async (_req, reply) => {
    sdkHeaders(reply);
    reply.type('text/javascript; charset=utf-8');
    return widgetSdkEmbedJs;
  });

  app.get('/sdk/index.js', async (_req, reply) => {
    sdkHeaders(reply);
    reply.type('text/javascript; charset=utf-8');
    return widgetSdkJs;
  });

  app.get('/sdk/embed.js', async (_req, reply) => {
    sdkHeaders(reply);
    reply.type('text/javascript; charset=utf-8');
    return widgetSdkEmbedJs;
  });
}

const here = dirname(fileURLToPath(import.meta.url));
const widgetSdkDistPath = join(here, '..', '..', '..', '..', 'packages', 'widget-sdk', 'dist', 'index.js');
const widgetSdkEmbedDistPath = join(here, '..', '..', '..', '..', 'packages', 'widget-sdk', 'dist', 'embed.js');

const CHAT_PAGE = (slug: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aelio — widget demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--black:#0A0A0A;--cream:#F5F0E8;--white:#fff;--ink-70:rgba(10,10,10,.66);--ink-45:rgba(10,10,10,.45);--hair:rgba(10,10,10,.12);--line:rgba(245,240,232,.14);--soft:rgba(245,240,232,.08);--soft-2:rgba(245,240,232,.04)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:
    radial-gradient(circle at top, rgba(255,255,255,.05), transparent 34%),
    linear-gradient(180deg, #111 0%, #0A0A0A 100%);
    color:var(--cream);min-height:100vh;-webkit-font-smoothing:antialiased}
  code{font-family:'SF Mono','Fira Code',monospace;font-size:.92em}
  .shell{max-width:1240px;margin:0 auto;padding:28px 20px 72px}
  .topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:28px}
  .brandline{display:flex;align-items:center;gap:12px}
  .branddot{width:11px;height:11px;border-radius:999px;background:#7ddc9b;box-shadow:0 0 0 6px rgba(125,220,155,.12)}
  .brandcopy{display:flex;flex-direction:column;gap:4px}
  .word{font-size:1.05rem;font-weight:800;letter-spacing:-.03em}
  .subword{font-size:.74rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(245,240,232,.52)}
  .statusbar{display:flex;flex-wrap:wrap;gap:10px}
  .statuspill{border:1px solid var(--line);background:var(--soft-2);border-radius:999px;padding:8px 12px;font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(245,240,232,.64)}
  .grid{display:grid;grid-template-columns:minmax(320px,420px) minmax(320px,1fr);gap:28px;align-items:start}
  .brand{padding:10px 0 8px}
  .wm{font-weight:800;letter-spacing:-.03em;font-size:2.1rem}
  .eyebrow{display:inline-flex;align-items:center;gap:.55rem;font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(245,240,232,.56)}
  .eyebrow::before{content:'';width:34px;height:1px;background:rgba(245,240,232,.34)}
  h1{margin-top:18px;font-size:clamp(2.4rem,5vw,4.4rem);line-height:.96;letter-spacing:-.05em}
  .lede{margin-top:16px;color:rgba(245,240,232,.74);font-size:1.05rem;max-width:34rem}
  .stack{display:grid;gap:16px;margin-top:28px}
  .card{padding:18px;border:1px solid var(--line);border-radius:22px;background:rgba(245,240,232,.05);backdrop-filter:blur(10px)}
  .card h2{font-size:.98rem;letter-spacing:.02em}
  .card p{margin-top:8px;color:rgba(245,240,232,.66);font-size:.95rem;line-height:1.55}
  .flow{display:grid;gap:10px;margin-top:14px}
  .flowitem{display:grid;grid-template-columns:28px 1fr;gap:12px;align-items:start;padding:10px 12px;border-radius:16px;background:var(--soft-2);border:1px solid rgba(245,240,232,.08)}
  .flowidx{width:28px;height:28px;border-radius:10px;background:rgba(245,240,232,.08);display:grid;place-items:center;font-size:.78rem;font-weight:700;color:rgba(245,240,232,.82)}
  .flowitem strong{display:block;font-size:.93rem}
  .flowitem span{display:block;margin-top:3px;color:rgba(245,240,232,.56);font-size:.86rem;line-height:1.45}
  .list{margin-top:12px;display:grid;gap:10px}
  .pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(245,240,232,.14);border-radius:999px;padding:10px 14px;color:rgba(245,240,232,.86);font-size:.94rem;background:rgba(245,240,232,.03);cursor:pointer;text-align:left}
  .pill:hover{background:rgba(245,240,232,.08)}
  .note{margin-top:14px;color:rgba(245,240,232,.52);font-size:.86rem}
  .stage{min-height:760px;border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg, rgba(245,240,232,.08), rgba(245,240,232,.02));position:relative;overflow:hidden}
  .stage::before{content:'';position:absolute;inset:0;background:
    radial-gradient(circle at 20% 15%, rgba(245,240,232,.12), transparent 18%),
    radial-gradient(circle at 85% 22%, rgba(245,240,232,.07), transparent 18%);pointer-events:none}
  .demo-header{position:absolute;top:18px;left:22px;right:22px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:rgba(245,240,232,.66);font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;z-index:2}
  .demotitle{display:flex;flex-direction:column;gap:6px}
  .demotitle strong{font-size:1rem;letter-spacing:-.02em;color:var(--cream);text-transform:none}
  .demotitle span{font-size:.72rem;color:rgba(245,240,232,.56)}
  .serverchip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(245,240,232,.14);background:rgba(245,240,232,.05);border-radius:999px;padding:8px 12px;font-size:.72rem}
  .serverchip::before{content:'';width:8px;height:8px;border-radius:999px;background:#7ddc9b}
  .mount-copy{position:absolute;left:22px;right:22px;bottom:18px;display:flex;justify-content:space-between;gap:12px;color:rgba(245,240,232,.48);font-size:.8rem;z-index:2}
  .widget-host{position:absolute;inset:78px 0 54px}
  @media (max-width: 920px){
    .shell{padding-bottom:40px}
    .topbar{align-items:flex-start;flex-direction:column}
    .grid{grid-template-columns:1fr}
    .stage{min-height:680px}
  }
  @media (max-width: 920px){
    .mount-copy{flex-direction:column}
  }
</style></head><body>
<div class="shell">
  <div class="topbar">
    <div class="brandline">
      <span class="branddot"></span>
      <div class="brandcopy">
        <span class="word">Aelio Demo Harness</span>
        <span class="subword">SDK Client + Runtime Server + Postgres SaaS</span>
      </div>
    </div>
    <div class="statusbar">
      <span class="statuspill">Tenant: ${slug}</span>
      <span class="statuspill">Route: /api/v1/chat/${slug}/message</span>
      <span class="statuspill"><a href="/demo/live" style="color:inherit;text-decoration:none">Postgres demo →</a></span>
      <span class="statuspill"><a href="/demo/telemetry" style="color:inherit;text-decoration:none">Telemetry →</a></span>
    </div>
  </div>

  <div class="grid">
    <section class="brand">
      <div class="eyebrow">Demo Story</div>
      <div class="wm">Aelio.</div>
      <h1>The SDK is the client. The server does the work.</h1>
      <p class="lede">The embeddable SDK collects user input and renders chat, while the runtime server runs policy and agent logic, then calls the <strong>demo customer backend</strong> over WebSocket. SaaS data persists in Postgres (<code>demo_saas_*</code> tables). For the live data panel, use <a href="/demo/live" style="color:#7ddc9b">/demo/live</a>.</p>

      <div class="stack">
        <div class="card">
          <h2>What this demo is showing</h2>
          <div class="flow">
            <div class="flowitem">
              <div class="flowidx">1</div>
              <div><strong>Embedded SDK widget</strong><span>The real <code>@aelio/widget-sdk</code> UI is mounted inline on the right.</span></div>
            </div>
            <div class="flowitem">
              <div class="flowidx">2</div>
              <div><strong>Runtime ingress</strong><span>Messages POST into <code>/api/v1/chat/${slug}/message</code> on this server.</span></div>
            </div>
            <div class="flowitem">
              <div class="flowidx">3</div>
              <div><strong>Policy + agent orchestration</strong><span>The runtime resolves state, tools, confirmation, and any verification requirements.</span></div>
            </div>
            <div class="flowitem">
              <div class="flowidx">4</div>
              <div><strong>Postgres SaaS path</strong><span>When actions fire, Convox handlers in the <code>demo-customer-backend</code> app read/write <code>demo_saas_*</code> tables.</span></div>
            </div>
          </div>
        </div>

        <div class="card">
          <h2>Try these flows</h2>
          <div class="list">
            <button class="pill" data-prompt="I just signed up, help me get started">Guided onboarding: I just signed up</button>
            <button class="pill" data-prompt="what's my plan?">Plan read: what's my plan?</button>
            <button class="pill" data-prompt="schedule the sales report to my manager weekly">Workflow action: schedule the sales report to my manager weekly</button>
            <button class="pill" data-prompt="I want to cancel my subscription">Sensitive action: I want to cancel my subscription</button>
            <button class="pill" data-prompt="downgrade me to starter">Tiered change: downgrade me to starter</button>
          </div>
          <p class="note">Action links still open in a new tab because that behavior is coming from the real SDK and real reply payloads, not from this wrapper page.</p>
        </div>
      </div>
    </section>

    <section class="stage">
      <div class="demo-header">
        <div class="demotitle">
          <strong>SDK Client Surface</strong>
          <span>Inline widget mount using the real embeddable chat UI</span>
        </div>
        <span class="serverchip">Runtime server live on ${slug}</span>
      </div>
      <div class="widget-host" id="widget-host"></div>
      <div class="mount-copy">
        <span>Mounted from <code>/sdk/index.js</code></span>
        <span>Server receives data, runs policy, then reaches the demo SaaS path</span>
      </div>
    </section>
  </div>
</div>
<script type="module">
  import { initAelio } from '/widget-sdk.js';

  const widget = initAelio({
    tenantSlug: ${JSON.stringify(slug)},
    apiBaseUrl: window.location.origin,
    accentColor: '#0A0A0A',
    widgetName: 'Acme Support',
    launcherText: 'Chat with Acme',
    container: '#widget-host',
    inline: true
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', async () => {
      widget.open();
      const text = button.getAttribute('data-prompt') || '';
      if (text) await widget.send(text);
    });
  });
</script></body></html>`;

const DEMO_LIVE_PAGE = (slug: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aelio — Postgres SaaS demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--black:#0A0A0A;--cream:#F5F0E8;--ink-70:rgba(245,240,232,.66);--line:rgba(245,240,232,.14);--soft:rgba(245,240,232,.06);--green:#7ddc9b;--amber:#f5c26b;--red:#ff8a80}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:linear-gradient(180deg,#121212 0%,#0A0A0A 100%);color:var(--cream);min-height:100vh}
  code{font-family:'SF Mono','Fira Code',monospace;font-size:.88em}
  .shell{max-width:1380px;margin:0 auto;padding:24px 20px 48px}
  .top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;margin-bottom:22px}
  .brand{font-weight:800;letter-spacing:-.03em;font-size:1.2rem}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-70)}
  .chip.live::before{content:'';display:inline-block;width:7px;height:7px;border-radius:999px;background:var(--green);margin-right:7px;box-shadow:0 0 0 4px rgba(125,220,155,.15)}
  .grid{display:grid;grid-template-columns:minmax(340px,1fr) minmax(360px,480px);gap:22px;align-items:start}
  .panel{border:1px solid var(--line);border-radius:24px;background:var(--soft);overflow:hidden}
  .panelhead{padding:16px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:10px}
  .panelhead h2{font-size:1rem;letter-spacing:-.02em}
  .panelhead p{margin-top:4px;font-size:.82rem;color:var(--ink-70)}
  .panelbody{padding:16px 18px 18px}
  .kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px}
  .stat{border:1px solid var(--line);border-radius:14px;padding:12px;background:rgba(245,240,232,.03)}
  .stat label{display:block;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-70)}
  .stat strong{display:block;margin-top:6px;font-size:1.05rem}
  .stat.cancelled strong{color:var(--red)}
  .stat.active strong{color:var(--green)}
  table{width:100%;border-collapse:collapse;font-size:.84rem}
  th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-70);font-weight:600}
  .empty{color:var(--ink-70);font-size:.86rem;padding:10px 0}
  .rowbtns{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
  .btn{appearance:none;border:1px solid var(--line);background:rgba(245,240,232,.05);color:var(--cream);border-radius:10px;padding:8px 12px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer}
  .btn:hover{background:rgba(245,240,232,.1)}
  .btn.danger{border-color:rgba(255,138,128,.35);color:var(--red)}
  .btn.primary{background:var(--cream);color:var(--black);border-color:transparent}
  .prompts{display:grid;gap:8px;margin-top:14px}
  .prompt{appearance:none;border:1px solid var(--line);background:rgba(245,240,232,.04);color:var(--cream);border-radius:12px;padding:10px 12px;text-align:left;font:inherit;cursor:pointer}
  .prompt:hover{background:rgba(245,240,232,.09)}
  .meta{margin-top:12px;font-size:.78rem;color:var(--ink-70);line-height:1.5}
  .stage{min-height:720px;position:relative}
  .stagehead{position:absolute;top:16px;left:18px;right:18px;z-index:2;display:flex;justify-content:space-between;gap:10px;font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-70)}
  .widget-host{position:absolute;inset:52px 0 0}
  .json{margin-top:12px;max-height:140px;overflow:auto;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:12px;padding:10px;font-size:.74rem;white-space:pre-wrap;color:rgba(245,240,232,.72)}
  .link{color:var(--green);text-decoration:none}
  @media (max-width: 980px){.grid{grid-template-columns:1fr}.stage{min-height:640px}}
</style></head><body>
<div class="shell">
  <div class="top">
    <div class="brand">Aelio Postgres Demo</div>
    <div class="chips">
      <span class="chip live">demo customer backend → Postgres</span>
      <span class="chip">tenant: ${slug}</span>
      <span class="chip"><a class="link" href="/demo/telemetry">telemetry</a></span>
      <span class="chip"><a class="link" href="/chat">/chat</a></span>
      <span class="chip"><a class="link" href="/api/v1/dev/convox/${slug}/tools">catalog</a></span>
    </div>
  </div>

  <div class="grid">
    <section class="panel">
      <div class="panelhead">
        <div>
          <h2>Live SaaS data (Postgres)</h2>
          <p>Tables: <code>demo_saas_accounts</code>, <code>demo_saas_reports</code>, <code>demo_saas_shares</code></p>
        </div>
        <button class="btn" id="refresh-btn">Refresh</button>
      </div>
      <div class="panelbody">
        <div class="kv" id="account-kv">
          <div class="stat"><label>Plan</label><strong id="plan">—</strong></div>
          <div class="stat"><label>Status</label><strong id="status">—</strong></div>
          <div class="stat"><label>Seats</label><strong id="seats">—</strong></div>
          <div class="stat"><label>Invoice</label><strong id="invoice">—</strong></div>
        </div>

        <h3 style="font-size:.82rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-70);margin-bottom:8px">Scheduled reports</h3>
        <div id="reports-wrap"><p class="empty">No reports yet — ask the agent to schedule one.</p></div>

        <h3 style="font-size:.82rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-70);margin:14px 0 8px">Shared access</h3>
        <div id="shares-wrap"><p class="empty">No shares yet — ask the agent to share a dashboard.</p></div>

        <div class="rowbtns">
          <button class="btn danger" id="reset-btn">Reset account to defaults</button>
        </div>

        <div class="meta">
          Session: <code id="session-id">waiting…</code><br>
          External user: <code id="external-user">—</code><br>
          Last sync: <code id="last-sync">—</code>
        </div>
        <pre class="json" id="raw-json">Waiting for widget session…</pre>

        <div class="prompts">
          <button class="prompt" data-prompt="I just signed up, help me get started">Onboarding: I just signed up</button>
          <button class="prompt" data-prompt="what's my plan and invoice?">Read: what's my plan and invoice?</button>
          <button class="prompt" data-prompt="schedule the sales report to my manager weekly">Write: schedule sales report weekly</button>
          <button class="prompt" data-prompt="share the revenue dashboard with jordan@acme.com">Write: share dashboard with jordan@acme.com</button>
          <button class="prompt" data-prompt="downgrade me to starter">Tier-2: downgrade to starter</button>
          <button class="prompt" data-prompt="I want to cancel my subscription">Tier-3: cancel subscription</button>
        </div>
      </div>
    </section>

    <section class="panel stage">
      <div class="stagehead">
        <span>Chat widget</span>
        <span>POST /api/v1/chat/${slug}/message</span>
      </div>
      <div class="widget-host" id="widget-host"></div>
    </section>
  </div>
</div>

<script type="module">
  import { initAelio } from '/widget-sdk.js';

  const slug = ${JSON.stringify(slug)};
  const widget = initAelio({
    tenantSlug: slug,
    apiBaseUrl: window.location.origin,
    accentColor: '#0A0A0A',
    widgetName: 'Acme Support',
    launcherText: 'Chat with Acme',
    container: '#widget-host',
    inline: true,
  });

  const sessionEl = document.getElementById('session-id');
  const externalEl = document.getElementById('external-user');
  const lastSyncEl = document.getElementById('last-sync');
  const rawEl = document.getElementById('raw-json');
  const planEl = document.getElementById('plan');
  const statusEl = document.getElementById('status');
  const seatsEl = document.getElementById('seats');
  const invoiceEl = document.getElementById('invoice');
  const reportsWrap = document.getElementById('reports-wrap');
  const sharesWrap = document.getElementById('shares-wrap');

  function sessionId() {
    return typeof widget.getSessionId === 'function' ? widget.getSessionId() : '';
  }

  function renderSnapshot(data) {
    if (!data || !data.account) return;
    planEl.textContent = data.account.plan;
    seatsEl.textContent = String(data.account.seats);
    statusEl.textContent = data.account.status;
    statusEl.parentElement.className = 'stat ' + (data.account.status === 'active' ? 'active' : 'cancelled');
    invoiceEl.textContent = data.invoice
      ? data.invoice.invoiceId + ' · $' + data.invoice.amount + ' ' + data.invoice.status
      : '—';

    if (Array.isArray(data.reports) && data.reports.length) {
      reportsWrap.innerHTML = '<table><thead><tr><th>Report</th><th>Recipient</th><th>Cadence</th><th></th></tr></thead><tbody>' +
        data.reports.map((r) =>
          '<tr><td>' + r.report + '</td><td>' + r.recipient + '</td><td>' + r.cadence +
          '</td><td><button class="btn danger" data-del-report="' + r.id + '">Delete</button></td></tr>'
        ).join('') + '</tbody></table>';
    } else {
      reportsWrap.innerHTML = '<p class="empty">No reports yet.</p>';
    }

    if (Array.isArray(data.shares) && data.shares.length) {
      sharesWrap.innerHTML = '<table><thead><tr><th>Resource</th><th>Member</th><th>Access</th><th></th></tr></thead><tbody>' +
        data.shares.map((s) =>
          '<tr><td>' + s.resource + '</td><td>' + s.member + '</td><td>' + s.access +
          '</td><td><button class="btn danger" data-del-share="' + encodeURIComponent(s.member) + '">Revoke</button></td></tr>'
        ).join('') + '</tbody></table>';
    } else {
      sharesWrap.innerHTML = '<p class="empty">No shares yet.</p>';
    }

    rawEl.textContent = JSON.stringify(data, null, 2);
    lastSyncEl.textContent = new Date().toLocaleTimeString();
  }

  async function refresh() {
    const sid = sessionId();
    sessionEl.textContent = sid || 'waiting…';
    if (!sid) return;
    const res = await fetch('/api/v1/dev/demo/' + slug + '/saas?sessionId=' + encodeURIComponent(sid));
    const json = await res.json();
    if (json.externalUserId) externalEl.textContent = json.externalUserId;
    renderSnapshot(json);
  }

  async function resetAccount() {
    const sid = sessionId();
    if (!sid || !confirm('Reset this session account to pro defaults?')) return;
    const res = await fetch('/api/v1/dev/demo/' + slug + '/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    });
    renderSnapshot(await res.json());
  }

  document.getElementById('refresh-btn').addEventListener('click', refresh);
  document.getElementById('reset-btn').addEventListener('click', resetAccount);

  document.body.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    const sid = sessionId();
    if (!sid) return;
    const reportId = t.getAttribute('data-del-report');
    if (reportId) {
      const res = await fetch('/api/v1/dev/demo/' + slug + '/reports/' + reportId + '?sessionId=' + encodeURIComponent(sid), { method: 'DELETE' });
      renderSnapshot(await res.json());
      return;
    }
    const member = t.getAttribute('data-del-share');
    if (member) {
      const res = await fetch('/api/v1/dev/demo/' + slug + '/shares/' + member + '?sessionId=' + encodeURIComponent(sid), { method: 'DELETE' });
      renderSnapshot(await res.json());
    }
  });

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.getAttribute('data-prompt') || '';
      if (!text) return;
      widget.open();
      await widget.send(text);
      setTimeout(refresh, 1200);
      setTimeout(refresh, 4000);
    });
  });

  const poll = setInterval(() => {
    refresh();
    if (sessionId()) return;
  }, 800);
  setTimeout(() => clearInterval(poll), 15000);
  setInterval(refresh, 5000);
</script></body></html>`;

const DEMO_TELEMETRY_PAGE = (slug: string, customerBackendUrl: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aelio — Turn telemetry</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0A0A0A;--cream:#F5F0E8;--muted:rgba(245,240,232,.58);--line:rgba(245,240,232,.12);--card:rgba(245,240,232,.04);--green:#7ddc9b;--amber:#f5c26b;--blue:#8ec8ff;--red:#ff8a80;--violet:#c4a8ff}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:var(--bg);color:var(--cream);min-height:100vh}
  code,pre{font-family:'JetBrains Mono',monospace}
  .shell{max-width:1440px;margin:0 auto;padding:20px 18px 40px}
  .top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
  .brand{font-weight:800;letter-spacing:-.03em}
  .links{display:flex;flex-wrap:wrap;gap:8px}
  .link{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:6px 11px;color:var(--muted);text-decoration:none}
  .link:hover{color:var(--cream);border-color:rgba(245,240,232,.28)}
  .grid{display:grid;grid-template-columns:minmax(380px,1fr) minmax(360px,440px);gap:18px;align-items:start}
  .panel{border:1px solid var(--line);border-radius:20px;background:var(--card);overflow:hidden}
  .panelhead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
  .panelhead h2{font-size:.95rem}
  .panelhead p{font-size:.78rem;color:var(--muted);margin-top:3px}
  .feed{padding:12px 14px 16px;max-height:calc(100vh - 120px);overflow:auto;display:flex;flex-direction:column;gap:12px}
  .empty{color:var(--muted);font-size:.88rem;padding:24px 8px;text-align:center}
  .turn{border:1px solid var(--line);border-radius:16px;background:rgba(0,0,0,.22);overflow:hidden}
  .turnhead{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line);background:rgba(245,240,232,.03)}
  .turnhead time{font-size:.72rem;color:var(--muted)}
  .pill{font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:4px 8px;border:1px solid var(--line)}
  .pill.state{color:var(--blue)}.pill.intent{color:var(--violet)}.pill.flow{color:var(--amber)}.pill.tool{color:var(--green)}
  .turnbody{padding:12px;display:grid;gap:10px}
  .row{display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:.82rem;align-items:start}
  .row label{color:var(--muted);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;padding-top:2px}
  .msguser{color:var(--cream);font-weight:600}
  .msgbot{color:rgba(245,240,232,.88);line-height:1.45}
  .phases{display:flex;flex-wrap:wrap;gap:5px}
  .phase{font-size:.68rem;padding:3px 7px;border-radius:6px;background:rgba(245,240,232,.08);border:1px solid var(--line)}
  .phase.on{background:rgba(142,200,255,.15);border-color:rgba(142,200,255,.35);color:var(--blue)}
  .tools{display:flex;flex-direction:column;gap:5px}
  .tool{font-size:.76rem;padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.25);border:1px solid var(--line)}
  .tool.ok{border-color:rgba(125,220,155,.35)}.tool.block{border-color:rgba(255,138,128,.35)}
  .flowsteps{display:flex;flex-direction:column;gap:4px;font-size:.76rem}
  .flowstep{padding:5px 8px;border-radius:8px;border:1px solid var(--line)}
  .flowstep.active{border-color:rgba(245,194,107,.45);background:rgba(245,194,107,.08)}
  .flags{display:flex;flex-wrap:wrap;gap:6px}
  .flag{font-size:.66rem;padding:3px 8px;border-radius:6px;background:rgba(255,138,128,.12);color:var(--red);border:1px solid rgba(255,138,128,.25)}
  .stage{min-height:720px;position:relative}
  .stagehead{position:absolute;top:14px;left:16px;right:16px;z-index:2;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between}
  .widget-host{position:absolute;inset:44px 0 0}
  .btn{appearance:none;border:1px solid var(--line);background:rgba(245,240,232,.05);color:var(--cream);border-radius:8px;padding:6px 10px;font:inherit;font-size:.75rem;cursor:pointer}
  @media(max-width:1000px){.grid{grid-template-columns:1fr}.feed{max-height:480px}}
</style></head><body>
<div class="shell">
  <div class="top">
    <div class="brand">Aelio Turn Telemetry</div>
    <div class="links">
      <a class="link" href="/demo/live">postgres demo</a>
      <a class="link" href="/chat">chat</a>
      <a class="link" href="/api/v1/dev/convox/${slug}/tools">catalog</a>
    </div>
  </div>
  <div class="grid">
    <section class="panel">
      <div class="panelhead">
        <div>
          <h2>Product telemetry (per message)</h2>
          <p>sender · tenant · session/identity · intent · state · flow · tool calls · harness phases</p>
        </div>
        <button class="btn" id="clear-feed">Clear</button>
      </div>
      <div class="feed" id="feed">
        <p class="empty">Send a message in the chat → telemetry appears here.</p>
      </div>
    </section>
    <section class="panel stage">
      <div class="stagehead">
        <span>Chat widget</span>
        <span id="session-label">session …</span>
      </div>
      <div class="widget-host" id="widget-host"></div>
    </section>
  </div>
</div>
<script type="module">
  import { initAelio } from '/widget-sdk.js';

  const slug = ${JSON.stringify(slug)};
  const customerBackendUrl = ${JSON.stringify(customerBackendUrl)};
  const feed = document.getElementById('feed');
  const sessionLabel = document.getElementById('session-label');
  let turnCount = 0;

  const widget = initAelio({
    tenantSlug: slug,
    apiBaseUrl: window.location.origin,
    identityTokenProvider: async (sessionId) => {
      const res = await fetch(customerBackendUrl + '/api/identity-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.identityToken) {
        throw new Error(json.error || 'customer backend identity token failed');
      }
      return json.identityToken;
    },
    accentColor: '#0A0A0A',
    widgetName: 'Acme Support',
    launcherText: 'Chat with Acme',
    container: '#widget-host',
    inline: true,
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await nativeFetch(input, init);
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/api/v1/chat/') && url.includes('/message') && init?.method === 'POST') {
      try {
        const clone = res.clone();
        const json = await clone.json();
        let userText = '';
        try {
          const body = JSON.parse(String(init.body || '{}'));
          userText = body.text || '';
        } catch {}
        appendTurn(userText, json);
      } catch {}
    }
    return res;
  };

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderPhases(phases) {
    if (!phases?.length) return '<span class="muted">—</span>';
    return '<div class="phases">' + phases.map((p) =>
      '<span class="phase on">' + esc(p) + '</span>'
    ).join('') + '</div>';
  }

  function renderTools(calls) {
    if (!calls?.length) return '<span style="color:var(--muted)">none</span>';
    return '<div class="tools">' + calls.map((t) =>
      '<div class="tool ' + (t.status === 'succeeded' ? 'ok' : 'block') + '">' +
      esc(t.key) + ' · tier ' + t.tier + ' · ' + esc(t.status) + '</div>'
    ).join('') + '</div>';
  }

  function renderFlow(flow) {
    if (!flow) return '<span style="color:var(--muted)">none</span>';
    const steps = (flow.steps || []).map((s) =>
      '<div class="flowstep' + (s.active ? ' active' : '') + '">' +
      (s.active ? '→ ' : '  ') + s.order + '. ' + esc(s.label) + '</div>'
    ).join('');
    return '<div><strong style="font-size:.78rem">' + esc(flow.stateKey) + ' / ' + esc(flow.objectiveKey) + '</strong>' +
      '<div class="flowsteps" style="margin-top:6px">' + steps + '</div></div>';
  }

  function appendTurn(userText, res) {
    const t = res.turnInsight;
    if (feed.querySelector('.empty')) feed.innerHTML = '';
    turnCount++;
    const card = document.createElement('article');
    card.className = 'turn';

    const insight = t || {};
    const ctx = insight.context || {};
    const inbound = insight.inbound || { message: userText, channel: 'web_chat' };
    const outbound = insight.outbound || {
      repliedBy: res.needsVerification ? 'system' : 'agent',
      replies: (res.replies || []).map((r) => ({ kind: r.kind, text: r.text })),
    };
    const state = insight.state || {
      current: res.state,
      previous: null,
      changed: res.stateChanged,
      confidence: res.confidence,
      completedObjectives: res.convoxPhase?.completedObjectives || [],
      reason: res.convoxPhase?.reason,
    };
    const intent = insight.intent || (res.activeIntent ? {
      key: res.activeIntent.intentKey,
      args: res.activeIntent.args,
      missingSlots: res.activeIntent.missingSlots,
      aborted: false,
    } : null);
    const flow = insight.flow || null;
    const tools = insight.toolCalls || res.actions || [];
    const phases = insight.harness || res.harness?.phases || [];
    const flags = insight.flags || {};

    const pills = [
      state.current ? '<span class="pill state">' + esc(state.current) + '</span>' : '',
      intent?.key ? '<span class="pill intent">' + esc(intent.key) + '</span>' : '',
      flow ? '<span class="pill flow">flow</span>' : '',
      tools.length ? '<span class="pill tool">' + tools.length + ' tool(s)</span>' : '',
    ].filter(Boolean).join('');

    const flagHtml = [
      flags.needsVerification || res.needsVerification ? '<span class="flag">verify</span>' : '',
      flags.awaitingConfirmation ? '<span class="flag">confirm pending</span>' : '',
      flags.stepUpRequired ? '<span class="flag">step-up</span>' : '',
      intent?.missingSlots?.length ? '<span class="flag">collect: ' + esc(intent.missingSlots.join(', ')) + '</span>' : '',
    ].filter(Boolean).join('');

    const replyText = (outbound.replies || []).map((r) =>
      '[' + r.kind + '] ' + r.text
    ).join('\\n') || '—';

    card.innerHTML =
      '<div class="turnhead">' +
        '<div>' + pills + (flagHtml ? '<div class="flags" style="margin-top:6px">' + flagHtml + '</div>' : '') + '</div>' +
        '<time>#' + turnCount + ' · ' + esc((insight.at || new Date().toISOString()).slice(11,19)) +
        (insight.latencyMs ? ' · ' + insight.latencyMs + 'ms' : '') + '</time>' +
      '</div>' +
      '<div class="turnbody">' +
        '<div class="row"><label>Message</label><div class="msguser">' + esc(inbound.message || userText) + '</div></div>' +
        '<div class="row"><label>Tenant</label><div><code>' + esc(ctx.tenantSlug || slug) + '</code> <span style="color:var(--muted)">(' + esc(ctx.tenantId || 'unknown') + ')</span></div></div>' +
        '<div class="row"><label>Session</label><div><code>' + esc(ctx.identifier || widget.getSessionId?.() || '') + '</code></div></div>' +
        '<div class="row"><label>Identity</label><div><code>' + esc(ctx.identityId || res.identityId || 'unverified') + '</code>' +
          (ctx.conversationId || res.conversationId ? '<br><span style="color:var(--muted);font-size:.76rem">conversation ' + esc(ctx.conversationId || res.conversationId) + '</span>' : '') +
          '</div></div>' +
        '<div class="row"><label>Replied by</label><div class="msgbot">' + esc(outbound.repliedBy) + '</div></div>' +
        '<div class="row"><label>Agent reply</label><div class="msgbot">' + esc(replyText) + '</div></div>' +
        '<div class="row"><label>Intent</label><div>' + (intent
          ? '<code>' + esc(intent.key) + '</code> args ' + esc(JSON.stringify(intent.args)) +
            (intent.missingSlots?.length ? ' · missing: ' + esc(intent.missingSlots.join(', ')) : '')
          : '<span style="color:var(--muted)">none / general</span>') + '</div></div>' +
        '<div class="row"><label>State</label><div>' + esc(state.current) +
          (state.changed ? ' <span style="color:var(--amber)">(changed)</span>' : '') +
          ' · conf ' + (state.confidence ?? res.confidence ?? 0).toFixed(2) +
          (state.reason ? '<br><span style="color:var(--muted);font-size:.76rem">' + esc(state.reason) + '</span>' : '') +
          '</div></div>' +
        '<div class="row"><label>Flow</label><div>' + renderFlow(flow) + '</div></div>' +
        '<div class="row"><label>Tool calls</label><div>' + renderTools(tools) + '</div></div>' +
        '<div class="row"><label>Harness</label><div>' + renderPhases(phases) + '</div></div>' +
      '</div>';

    feed.prepend(card);
    if (typeof widget.getSessionId === 'function') {
      sessionLabel.textContent = 'session ' + widget.getSessionId();
    }
  }

  document.getElementById('clear-feed').addEventListener('click', () => {
    feed.innerHTML = '<p class="empty">Send a message in the chat → telemetry appears here.</p>';
    turnCount = 0;
  });

  const prompts = [
    'I just signed up, help me get started',
    "what's my plan?",
    'schedule the sales report to my manager weekly',
    'downgrade me to starter',
    'I want to cancel my subscription',
  ];
  // Expose for console: window.__demoPrompts
  window.__demoPrompts = prompts;

  setInterval(() => {
    if (typeof widget.getSessionId === 'function' && widget.getSessionId()) {
      sessionLabel.textContent = 'session ' + widget.getSessionId();
    }
  }, 1000);
</script></body></html>`;

const CUSTOMER_DEMO_PAGE = (slug: string, customerBackendUrl: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme Customer Site — Aelio SDK Demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--ink:#131313;--bg:#f6f1e8;--paper:#fffdf8;--line:rgba(19,19,19,.1);--muted:rgba(19,19,19,.62);--accent:#0A0A0A}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:
    radial-gradient(circle at top left, rgba(0,0,0,.04), transparent 24%),
    linear-gradient(180deg, #f8f4ec 0%, #f1eadf 100%);
    color:var(--ink);min-height:100vh}
  code{font-family:'SF Mono','Fira Code',monospace;font-size:.92em}
  .shell{max-width:1240px;margin:0 auto;padding:28px 20px 56px}
  .nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border:1px solid var(--line);background:rgba(255,253,248,.78);backdrop-filter:blur(10px);border-radius:20px}
  .brand{font-weight:800;letter-spacing:-.04em;font-size:1.35rem}
  .navmeta{display:flex;flex-wrap:wrap;gap:8px}
  .chip{border:1px solid var(--line);background:rgba(255,255,255,.78);border-radius:999px;padding:7px 10px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .grid{display:grid;grid-template-columns:minmax(320px,420px) minmax(340px,1fr);gap:24px;margin-top:22px}
  .hero{padding:14px 2px 0}
  .eyebrow{font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
  h1{margin-top:14px;font-size:clamp(2.6rem,5vw,4.5rem);line-height:.96;letter-spacing:-.06em}
  .lede{margin-top:16px;font-size:1.02rem;line-height:1.6;color:var(--muted)}
  .stack{display:grid;gap:14px;margin-top:22px}
  .card{padding:18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.72);box-shadow:0 18px 48px rgba(35,29,20,.06)}
  .card h2{font-size:1rem}
  .card p{margin-top:8px;color:var(--muted);line-height:1.55}
  .list{display:grid;gap:10px;margin-top:14px}
  .prompt{appearance:none;border:1px solid var(--line);background:#fff;border-radius:16px;padding:12px 14px;text-align:left;font:inherit;cursor:pointer}
  .prompt strong{display:block;font-size:.95rem}
  .prompt span{display:block;margin-top:4px;color:var(--muted);font-size:.88rem}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .action{appearance:none;border:none;background:var(--accent);color:#fff;border-radius:12px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}
  .secondary{appearance:none;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:12px;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer}
  .panel{border:1px solid var(--line);border-radius:28px;background:rgba(255,253,248,.76);min-height:760px;position:relative;overflow:hidden;box-shadow:0 28px 80px rgba(35,29,20,.08)}
  .panelhead{position:absolute;top:18px;left:22px;right:22px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;z-index:2}
  .title strong{display:block;font-size:1rem;letter-spacing:-.02em}
  .title span{display:block;margin-top:5px;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .mount{position:absolute;inset:78px 0 0}
  .inspector{position:absolute;left:18px;right:18px;bottom:18px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.88);padding:14px;z-index:2}
  .inspector h3{font-size:.92rem}
  .meta{margin-top:8px;display:grid;gap:6px;color:var(--muted);font-size:.86rem}
  .meta code{color:var(--ink)}
  .result{margin-top:10px;max-height:180px;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px;font-size:.8rem;white-space:pre-wrap}
  @media (max-width: 960px){.grid{grid-template-columns:1fr}.panel{min-height:680px}}
</style></head><body>
<div class="shell">
  <div class="nav">
    <div class="brand">Acme Analytics</div>
    <div class="navmeta">
      <span class="chip">Customer Site</span>
      <span class="chip">Loads /sdk/embed.js</span>
      <span class="chip">POST -> /api/v1/chat/${slug}/message</span>
    </div>
  </div>

  <div class="grid">
    <section class="hero">
      <div class="eyebrow">Customer-side integration test</div>
      <h1>Load the SDK exactly like a customer would.</h1>
      <p class="lede">This page simulates a real customer website. The chat widget is not initialized by the demo harness logic; it is bootstrapped by the SDK’s own browser embed entry using <code>data-tenant</code> and <code>data-api</code> attributes.</p>

      <div class="stack">
        <div class="card">
          <h2>How this test works</h2>
          <p>The script below mirrors a real customer setup: frontend widget on the site, customer backend minting signed identity tokens, and the Aelio server handling the conversation and tool orchestration.</p>
          <div class="result">&lt;script type="module"&gt;
  import { initAelio } from 'https://api.yoursaas.com/sdk/index.js';
  initAelio({ tenantSlug: '${slug}', apiBaseUrl: 'https://api.yoursaas.com', ... });
&lt;/script&gt;</div>
        </div>

        <div class="card">
          <h2>Quick prompts</h2>
          <div class="list">
            <button class="prompt" data-prompt="I just signed up, help me get started"><strong>Onboarding flow</strong><span>Infers <code>onboarding</code> phase and shows guided objectives in the widget.</span></button>
            <button class="prompt" data-prompt="what's my plan?"><strong>Read current plan</strong><span>Simple read-only action against the mock account.</span></button>
            <button class="prompt" data-prompt="schedule the sales report to my manager weekly"><strong>Schedule report</strong><span>Completes <code>schedule_first_report</code> objective in onboarding.</span></button>
            <button class="prompt" data-prompt="downgrade me to starter"><strong>Change plan</strong><span>Exercises a reversible write with confirmation.</span></button>
            <button class="prompt" data-prompt="I want to cancel my subscription"><strong>Cancel subscription</strong><span>Infers <code>churn</code> phase with retention objectives.</span></button>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panelhead">
        <div class="title">
          <strong>Embedded chat widget</strong>
          <span>bootstrapped by the SDK and identified via customer backend</span>
        </div>
        <button class="secondary" id="open-widget">Open chat</button>
      </div>
      <div class="mount" id="customer-site-root" data-aelio-mount></div>
      <div class="inspector">
        <h3>Mock SaaS inspector</h3>
        <div class="meta">
          <div>Session ID: <code id="session-id">waiting…</code></div>
          <div>Customer backend: <code id="customer-backend-url">${customerBackendUrl}</code></div>
          <div>Convox catalog: <code id="inspect-url">waiting…</code></div>
          <div>Active phase: <code id="phase-state">—</code></div>
        </div>
        <div class="row">
          <button class="secondary" id="inspect-state">Inspect Convox catalog</button>
          <button class="secondary" id="inspect-phase">Inspect guided phase</button>
          <button class="secondary" id="inspect-account">Inspect mock account</button>
        </div>
        <pre class="result" id="inspect-result">No mock account state fetched yet.</pre>
      </div>
    </section>
  </div>
</div>

<script type="module">
  import { initAelio } from '/sdk/index.js';

  const slug = ${JSON.stringify(slug)};
  const customerBackendUrl = ${JSON.stringify(customerBackendUrl)};
  window.AelioWidget = initAelio({
    tenantSlug: slug,
    apiBaseUrl: window.location.origin,
    identityTokenProvider: async (sessionId) => {
      const res = await fetch(customerBackendUrl + '/api/identity-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.identityToken) {
        throw new Error(json.error || 'customer backend identity token failed');
      }
      return json.identityToken;
    },
    accentColor: '#0A0A0A',
    widgetName: 'Acme Support',
    launcherText: 'Talk to Acme',
    container: '#customer-site-root',
    inline: true,
  });
</script>
<script>
  const slug = ${JSON.stringify(slug)};
  const sessionEl = document.getElementById('session-id');
  const urlEl = document.getElementById('inspect-url');
  const phaseEl = document.getElementById('phase-state');
  const resultEl = document.getElementById('inspect-result');

  function sessionId() {
    return window.AelioWidget && typeof window.AelioWidget.getSessionId === 'function'
      ? window.AelioWidget.getSessionId()
      : '';
  }

  function refreshMeta() {
    const sid = sessionId();
    sessionEl.textContent = sid || 'waiting…';
    urlEl.textContent = '/api/v1/dev/convox/' + slug + '/tools';
  }

  async function inspectCatalog() {
    refreshMeta();
    const res = await fetch('/api/v1/dev/convox/' + slug + '/tools');
    const json = await res.json();
    resultEl.textContent = JSON.stringify(json, null, 2);
    if (Array.isArray(json.liveStates)) {
      phaseEl.textContent = json.liveStates.join(', ') || '—';
    }
  }

  async function inspectPhase() {
    refreshMeta();
    const sid = sessionId();
    if (!sid) {
      resultEl.textContent = 'Widget session is not ready yet.';
      return;
    }
    const res = await fetch('/api/v1/dev/convox/' + slug + '/session/' + encodeURIComponent(sid) + '/phase');
    const json = await res.json();
    resultEl.textContent = JSON.stringify(json, null, 2);
    phaseEl.textContent = json.convoxPhase?.currentState || '—';
  }

  async function inspectAccount() {
    refreshMeta();
    const sid = sessionId();
    if (!sid) {
      resultEl.textContent = 'Widget session is not ready yet.';
      return;
    }
    const res = await fetch('/api/v1/dev/demo/' + slug + '/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    });
    const json = await res.json();
    resultEl.textContent = JSON.stringify(json, null, 2);
  }

  document.getElementById('open-widget').addEventListener('click', () => {
    window.AelioWidget && window.AelioWidget.open && window.AelioWidget.open();
  });
  document.getElementById('inspect-state').addEventListener('click', inspectCatalog);
  document.getElementById('inspect-phase').addEventListener('click', inspectPhase);
  document.getElementById('inspect-account').addEventListener('click', inspectAccount);

  document.querySelectorAll('[data-prompt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const text = button.getAttribute('data-prompt') || '';
      if (!text || !window.AelioWidget) return;
      window.AelioWidget.open();
      await window.AelioWidget.send(text);
      refreshMeta();
      await inspectPhase();
    });
  });

  const wait = setInterval(() => {
    refreshMeta();
    if (sessionId()) clearInterval(wait);
  }, 250);
</script></body></html>`;
