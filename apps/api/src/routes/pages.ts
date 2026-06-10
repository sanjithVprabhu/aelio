import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';

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

export function registerPageRoutes(app: FastifyInstance, c: Container): void {
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
    return CHAT_PAGE(c.demoTenantSlug);
  });
}

const CHAT_PAGE = (slug: string) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aelio — live demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--black:#0A0A0A;--cream:#F5F0E8;--white:#fff;--ink-70:rgba(10,10,10,.66);--ink-45:rgba(10,10,10,.45);--hair:rgba(10,10,10,.12)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:var(--black);color:var(--cream);min-height:100vh;display:flex;flex-direction:column;align-items:center;-webkit-font-smoothing:antialiased}
  .top{width:100%;max-width:680px;display:flex;align-items:center;gap:.6rem;padding:1.4rem 1.2rem .4rem}
  .top .wm{font-weight:700;letter-spacing:-.01em;font-size:1.25rem}
  .top .tag{margin-left:auto;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(245,240,232,.5)}
  .stage{width:100%;max-width:680px;flex:1;display:flex;flex-direction:column;padding:1rem 1.2rem 1.4rem}
  .panel{background:var(--cream);color:var(--black);border-radius:14px;flex:1;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px -36px rgba(0,0,0,.7)}
  .head{display:flex;align-items:center;gap:.65rem;padding:1rem 1.2rem;border-bottom:1px solid var(--hair)}
  .ae{width:30px;height:30px;border-radius:7px;background:var(--black);color:var(--cream);display:grid;place-items:center;font-weight:800;font-size:.9rem}
  .who{font-weight:600;font-size:.95rem}
  .chip{margin-left:auto;font-size:.68rem;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-45);font-weight:600;border:1px solid var(--hair);border-radius:100px;padding:.3em .7em}
  .msgs{flex:1;overflow-y:auto;padding:1.2rem;display:flex;flex-direction:column;gap:.7rem}
  .m{max-width:84%;font-size:.95rem;line-height:1.45}
  .m .b{display:inline-block;padding:.62rem .9rem;border-radius:12px}
  .m.user{align-self:flex-end;text-align:right}
  .m.user .b{background:#262626;color:var(--cream);border-bottom-right-radius:4px}
  .m.ae{align-self:flex-start}
  .m.ae .b{background:var(--white);border:1px solid var(--hair);border-bottom-left-radius:4px}
  .m.sys{align-self:center;font-size:.78rem;color:var(--ink-45)}
  .link-btn{margin-top:.5rem;background:var(--black);color:var(--cream);border:none;padding:.55em 1em;border-radius:7px;font-weight:600;cursor:pointer;font-family:inherit;font-size:.85rem}
  .compose{display:flex;gap:.6rem;padding:.9rem 1rem;border-top:1px solid var(--hair)}
  .compose input{flex:1;font-family:inherit;font-size:.98rem;border:1px solid var(--hair);border-radius:9px;padding:.7em .9em}
  .compose input:focus{outline:none;border-color:var(--black)}
  .compose button{background:var(--black);color:var(--cream);border:none;border-radius:9px;padding:0 1.1em;font-weight:600;cursor:pointer;font-family:inherit}
  .sugg{display:flex;gap:.5rem;flex-wrap:wrap;padding:0 1rem .9rem}
  .sugg button{background:transparent;border:1px solid var(--hair);border-radius:100px;padding:.4em .8em;font-size:.82rem;cursor:pointer;font-family:inherit;color:var(--ink-70)}
</style></head><body>
<div class="top"><span class="wm">Aelio<span>.</span></span><span class="tag">live runtime · scripted llm</span></div>
<div class="stage"><div class="panel">
  <div class="head"><div class="ae">A</div><span class="who">Aelio</span><span class="chip" id="chip">unverified</span></div>
  <div class="msgs" id="msgs"></div>
  <div class="sugg" id="sugg"></div>
  <form class="compose" id="form"><input id="input" placeholder="Ask Aelio to do something…" autocomplete="off"><button>Send</button></form>
</div></div>
<script>
const SLUG=${JSON.stringify(slug)};
const sessionId='web_'+Math.random().toString(36).slice(2,10);
const msgs=document.getElementById('msgs');const chip=document.getElementById('chip');
let lastUserText='';
const SUGG=["what's my plan?","schedule the sales report to my manager weekly","I want to cancel my subscription","downgrade me to starter"];
function suggest(){const s=document.getElementById('sugg');s.innerHTML='';SUGG.forEach(t=>{const b=document.createElement('button');b.textContent=t;b.onclick=()=>send(t);s.appendChild(b)})}
function bubble(cls,html){const d=document.createElement('div');d.className='m '+cls;d.innerHTML=html;msgs.appendChild(d);msgs.scrollTop=msgs.scrollHeight;return d}
function esc(s){return s.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}
async function send(text){
  if(!text)return;lastUserText=text;bubble('user','<span class="b">'+esc(text)+'</span>');
  const res=await fetch('/api/v1/chat/'+SLUG+'/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId,text})});
  const r=await res.json();
  chip.textContent=r.state||chip.textContent;
  for(const rep of r.replies){
    if(rep.kind==='magic_link'||rep.kind==='step_up'){
      const d=bubble('ae','<span class="b">'+esc(rep.text.split(': http')[0])+'</span>');
      const btn=document.createElement('button');btn.className='link-btn';
      btn.textContent=rep.kind==='step_up'?'Re-verify it\\'s me →':'Verify it\\'s me →';
      btn.onclick=async()=>{btn.disabled=true;await fetch('/api/v1/dev/follow',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:rep.url})});bubble('sys','✓ identity confirmed');send(rep.kind==='step_up'?'ok done':lastUserText)};
      d.appendChild(btn);
    } else if(rep.kind==='handoff'){
      bubble('ae','<span class="b">'+esc(rep.text)+'</span>');bubble('sys','→ handed off to a human agent');
    } else {
      bubble('ae','<span class="b">'+esc(rep.text)+'</span>');
    }
  }
}
document.getElementById('form').addEventListener('submit',e=>{e.preventDefault();const i=document.getElementById('input');const t=i.value.trim();i.value='';send(t)});
suggest();bubble('ae','<span class="b">Hi — I\\'m Aelio, the conversational layer for Acme Analytics. Ask me to do something with your account.</span>');
</script></body></html>`;
