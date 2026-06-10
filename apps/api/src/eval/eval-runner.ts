import {
  ChannelType,
  type EvalAssert,
  type EvalAssertResult,
  type EvalRun,
  type EvalScenario,
  type EvalScenarioResult,
} from '@aelio/types';
import type { Container } from '../container.js';
import type { RuntimeResult } from '../agent/runtime.js';
import { uuid } from '../util/id.js';

/**
 * Offline eval harness (manual §10). Runs admin-authored scenarios against the
 * live agent runtime in an isolated sandbox identity per scenario, then checks
 * each assertion. `llm_judge` asserts use a deterministic keyword rubric here
 * (a real build calls a small model).
 */
export class EvalRunner {
  constructor(private readonly c: Container) {}

  async runSuite(tenantId: string, suiteId: string, playbookVersion: string): Promise<EvalRun> {
    const scenarios = this.c.store.listEvalScenarios(tenantId, suiteId);
    const results: EvalScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await this.runScenario(tenantId, scenario));
    }
    const run: EvalRun = {
      id: uuid(),
      suiteId,
      tenantId,
      playbookVersion,
      status: 'completed',
      passCount: results.filter((r) => r.status === 'passed').length,
      failCount: results.filter((r) => r.status === 'failed').length,
      results,
      startedAt: new Date(),
      completedAt: new Date(),
    };
    this.c.store.putEvalRun(run);
    return run;
  }

  private async runScenario(tenantId: string, scenario: EvalScenario): Promise<EvalScenarioResult> {
    const tenant = this.c.store.getTenant(tenantId)!;
    const identifier = `eval_${scenario.id}_${uuid().slice(0, 6)}`;
    const ch = ChannelType.WebChat;

    const accActions: string[] = [];
    let lastResult: RuntimeResult | undefined;
    let lastResponse = '';
    let escalated = false;
    const assertResults: EvalAssertResult[] = [];
    let stepsPassed = 0;
    let failureStep: number | undefined;

    const send = async (text: string): Promise<RuntimeResult> => {
      let r = await this.c.runtime.handleInbound({ tenantId, channelType: ch, identifier, text });
      if (r.needsVerification) {
        // Auto-verify the sandbox identity, then resend.
        const url = r.replies[0]?.url;
        if (url) await this.c.identity.verifyMagicLink(url.split('/').pop()!);
        r = await this.c.runtime.handleInbound({ tenantId, channelType: ch, identifier, text });
      }
      return r;
    };

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i]!;
      if (step.role === 'user') {
        lastResult = await send(step.content);
        for (const a of lastResult.actions) accActions.push(a.key);
        lastResponse = lastResult.replies.map((x) => x.text).join(' ');
        if (lastResult.escalated) escalated = true;
        stepsPassed++;
      } else {
        const res = this.checkAssert(step.assert, {
          actions: accActions,
          response: lastResponse,
          state: lastResult?.state ?? 'unverified',
          escalated,
        });
        assertResults.push(res);
        if (res.passed) stepsPassed++;
        else if (failureStep === undefined) failureStep = i;
      }
    }

    const finalState = lastResult?.state ?? 'unverified';
    const expectedOk =
      !scenario.expectedFinalState || scenario.expectedFinalState === finalState;
    const passed = assertResults.every((r) => r.passed) && expectedOk;

    return {
      scenarioId: scenario.id,
      name: scenario.name,
      status: passed ? 'passed' : 'failed',
      stepsPassed,
      stepsTotal: scenario.steps.length,
      failureStep,
      assertResults,
      finalState,
    };
  }

  private checkAssert(
    assert: EvalAssert,
    ctx: { actions: string[]; response: string; state: string; escalated: boolean },
  ): EvalAssertResult {
    const pass = (passed: boolean, explanation: string): EvalAssertResult => ({ assert, passed, explanation });
    switch (assert.type) {
      case 'action_called':
        return pass(ctx.actions.includes(assert.actionKey), `expected ${assert.actionKey} to be called`);
      case 'action_not_called':
        return pass(!ctx.actions.includes(assert.actionKey), `expected ${assert.actionKey} NOT to be called`);
      case 'state_transitioned':
        return pass(ctx.state === assert.toState, `expected state ${assert.toState}, got ${ctx.state}`);
      case 'final_state_is':
        return pass(ctx.state === assert.state, `expected final state ${assert.state}, got ${ctx.state}`);
      case 'response_contains':
        return pass(ctx.response.toLowerCase().includes(assert.text.toLowerCase()), `response should contain "${assert.text}"`);
      case 'response_does_not_contain':
        return pass(!ctx.response.toLowerCase().includes(assert.text.toLowerCase()), `response should not contain "${assert.text}"`);
      case 'escalation_triggered':
        return pass(ctx.escalated, 'expected an escalation');
      case 'llm_judge': {
        // Deterministic rubric proxy: all rubric keywords must appear.
        const keywords = assert.rubric.toLowerCase().match(/[a-z]{4,}/g) ?? [];
        const hits = keywords.filter((k) => ctx.response.toLowerCase().includes(k)).length;
        return pass(hits >= Math.ceil(keywords.length / 3), `rubric match ${hits}/${keywords.length}`);
      }
    }
  }
}
