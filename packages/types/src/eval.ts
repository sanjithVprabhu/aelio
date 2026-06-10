export type EvalStep =
  | { role: 'user'; content: string }
  | { role: 'assert'; assert: EvalAssert };

export type EvalAssert =
  | { type: 'action_called'; actionKey: string }
  | { type: 'action_not_called'; actionKey: string }
  | { type: 'state_transitioned'; toState: string }
  | { type: 'response_contains'; text: string }
  | { type: 'response_does_not_contain'; text: string }
  | { type: 'escalation_triggered' }
  | { type: 'final_state_is'; state: string }
  | { type: 'llm_judge'; rubric: string };

export interface EvalScenario {
  id: string;
  suiteId: string;
  tenantId: string;
  name: string;
  steps: EvalStep[];
  expectedFinalState?: string;
  createdAt: Date;
}

export interface EvalSuite {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  createdAt: Date;
}

export interface EvalAssertResult {
  assert: EvalAssert;
  passed: boolean;
  explanation: string;
}

export interface EvalScenarioResult {
  scenarioId: string;
  name: string;
  status: 'passed' | 'failed';
  stepsPassed: number;
  stepsTotal: number;
  failureStep?: number;
  assertResults: EvalAssertResult[];
  finalState: string;
}

export interface EvalRun {
  id: string;
  suiteId: string;
  tenantId: string;
  playbookVersion: string;
  status: 'running' | 'completed' | 'failed';
  passCount: number;
  failCount: number;
  results: EvalScenarioResult[];
  startedAt: Date;
  completedAt?: Date;
}
