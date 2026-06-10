import type { EvalRun } from '@aelio/types';

/**
 * apps/eval-runner — offline eval harness CLI (manual §11). Drives the api's
 * eval endpoints over HTTP: lists each suite for the tenant, runs it against the
 * live agent runtime, and prints a pass/fail report. Exits non‑zero on any
 * failure so it can gate CI.
 *
 *   API_BASE_URL=http://localhost:3000 TENANT=acme pnpm --filter @aelio/eval-runner run
 */

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const TENANT = process.env.TENANT ?? 'acme';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface SuiteSummary {
  id: string;
  name: string;
  scenarios: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST' });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  console.log(`${BOLD}Aelio eval-runner${RESET} — tenant "${TENANT}" @ ${API_BASE_URL}\n`);

  let suites: SuiteSummary[];
  try {
    suites = await getJson<SuiteSummary[]>(`/api/v1/t/${TENANT}/evals/suites`);
  } catch (err) {
    console.error(`${RED}Could not reach the api. Is it running?${RESET}`, (err as Error).message);
    process.exit(2);
  }

  let totalPass = 0;
  let totalFail = 0;

  for (const suite of suites) {
    console.log(`${BOLD}▸ ${suite.name}${RESET} ${DIM}(${suite.scenarios} scenarios)${RESET}`);
    const run = await postJson<EvalRun>(`/api/v1/t/${TENANT}/evals/suites/${suite.id}/run`);
    for (const r of run.results) {
      const mark = r.status === 'passed' ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`  ${mark} ${r.name} ${DIM}(${r.stepsPassed}/${r.stepsTotal} steps, final=${r.finalState})${RESET}`);
      for (const a of r.assertResults.filter((x) => !x.passed)) {
        console.log(`      ${RED}↳ ${a.explanation}${RESET}`);
      }
    }
    totalPass += run.passCount;
    totalFail += run.failCount;
    console.log('');
  }

  const color = totalFail === 0 ? GREEN : RED;
  console.log(`${color}${BOLD}${totalPass} passed, ${totalFail} failed${RESET}\n`);
  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
