import { ChannelType } from '@aelio/types';
import { createContainer, type Container } from '../container.js';
import type { RuntimeResult } from '../agent/runtime.js';

/**
 * End-to-end demonstration of the Aelio runtime, exercising the manual's
 * cross-layer scenarios against the live engine with the deterministic scripted
 * LLM (zero external services). Run with: `pnpm --filter @aelio/api demo`.
 */

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function tokenFrom(url?: string): string {
  return url ? url.split('/').pop()! : '';
}

function printResult(c: Container, who: string, text: string, r: RuntimeResult): void {
  console.log(`${BOLD}${CYAN}user:${RESET} ${text}`);
  for (const reply of r.replies) {
    const tag =
      reply.kind === 'magic_link'
        ? `${YELLOW}[magic link]${RESET}`
        : reply.kind === 'step_up'
          ? `${YELLOW}[step-up]${RESET}`
          : reply.kind === 'handoff'
            ? `${YELLOW}[handoff]${RESET}`
            : `${GREEN}aelio:${RESET}`;
    console.log(`${tag} ${reply.text}`);
  }
  const meta: string[] = [`state=${r.state}`];
  if (r.stateChanged) meta.push('state-changed');
  if (r.actions.length)
    meta.push(`actions=[${r.actions.map((a) => `${a.key}/T${a.tier}:${a.status}`).join(', ')}]`);
  if (r.triggersFired.length) meta.push(`triggers=[${r.triggersFired.join(', ')}]`);
  if (r.escalated) meta.push('escalated');
  console.log(`${DIM}  · ${meta.join('  ·  ')}${RESET}\n`);
}

function section(title: string): void {
  console.log(`\n${BOLD}━━━ ${title} ━━━${RESET}\n`);
}

async function main(): Promise<void> {
  const c = createContainer({ baseUrl: 'http://localhost:3000' });
  const tenant = c.store.getTenantBySlug('acme')!;
  const ch = ChannelType.WebChat;

  console.log(`${BOLD}Aelio runtime demo${RESET} — tenant "${tenant.name}" (scripted LLM, in-memory)\n`);
  console.log(
    `${DIM}Exposed actions: ${c.store
      .listExposedActions(tenant.id)
      .map((a) => `${a.key}(T${a.tier})`)
      .join(', ')}${RESET}`,
  );

  // ── Scenario A — first touch + magic-link verification + Tier 0 action ──
  section('Scenario A — verify identity, then a read (Tier 0) action');
  const webId = 'web_demo_user';
  let r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: "what's my plan?" });
  printResult(c, webId, "what's my plan?", r);
  if (r.needsVerification) {
    const token = tokenFrom(r.replies[0]?.url);
    const { identity } = await c.identity.verifyMagicLink(token);
    console.log(`${DIM}  → magic link verified for ${identity.externalUserId} (${identity.metadata.name})${RESET}\n`);
  }
  r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: "what's my plan?" });
  printResult(c, webId, "what's my plan?", r);

  // ── Scenario C — trigger-driven state transition (retention) ──
  section('Scenario C — cancellation intent fires a retention state transition');
  r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: 'I want to cancel my subscription' });
  printResult(c, webId, 'I want to cancel my subscription', r);

  // ── Scenario B — Tier 3 with confirmation + step-up ──
  section('Scenario B — Tier 3 cancel: confirmation → step-up → execute');
  r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: 'yes, go ahead and cancel' });
  printResult(c, webId, 'yes, go ahead and cancel', r);
  const stepUpUrl = r.replies.find((x) => x.kind === 'step_up')?.url;
  if (stepUpUrl) {
    await c.identity.completeStepUp(tokenFrom(stepUpUrl));
    console.log(`${DIM}  → user completed step-up verification${RESET}\n`);
    r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: 'ok done' });
    printResult(c, webId, 'ok done', r);
  }

  // ── Tier 2 confirmation (no step-up) — change plan ──
  section('Bonus — Tier 2 plan change: confirmation, then execute (no step-up)');
  r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: 'actually downgrade me to starter' });
  printResult(c, webId, 'actually downgrade me to starter', r);
  r = await c.runtime.handleInbound({ tenantId: tenant.id, channelType: ch, identifier: webId, text: 'yes please' });
  printResult(c, webId, 'yes please', r);

  // ── Audit trail proof ──
  section('Audit trail (append-only) for this conversation');
  const conv = c.store.findActiveConversation(tenant.id, r.identityId!) ?? c.store.listConversations(tenant.id)[0]!;
  for (const e of c.store.listAudit(tenant.id, conv.id).slice(0, 12).reverse()) {
    console.log(`${DIM}  ${e.createdAt.toISOString()}  ${e.eventType}  ${JSON.stringify(e.payload).slice(0, 80)}${RESET}`);
  }

  console.log(`\n${BOLD}${GREEN}✓ demo complete${RESET} — every action passed through the four-tier policy gates and the user's own scoped token.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
