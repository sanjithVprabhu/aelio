/** Rigid turn harness phases (Aelio Server v2). */
export type HarnessPhase =
  | 'RESOLVE'
  | 'ROUTE'
  | 'COLLECT'
  | 'PLAN'
  | 'VALIDATE'
  | 'CONFIRM'
  | 'EXECUTE'
  | 'SYNTHESIZE';

export interface HarnessTrace {
  phases: HarnessPhase[];
  startedAt: number;
}

export function createHarnessTrace(): HarnessTrace {
  return { phases: [], startedAt: Date.now() };
}

export function advance(trace: HarnessTrace, phase: HarnessPhase): void {
  trace.phases.push(phase);
}

/** Decide next harness phase from intent + awaiting confirmation state. */
export function planHarnessPhases(input: {
  hasActiveIntent: boolean;
  missingSlots: number;
  awaitingConfirmation: boolean;
  willExecuteTools: boolean;
}): HarnessPhase[] {
  const phases: HarnessPhase[] = ['RESOLVE', 'ROUTE'];
  if (input.hasActiveIntent && input.missingSlots > 0) phases.push('COLLECT');
  phases.push('PLAN');
  phases.push('VALIDATE');
  if (input.awaitingConfirmation) phases.push('CONFIRM');
  if (input.willExecuteTools) phases.push('EXECUTE');
  phases.push('SYNTHESIZE');
  return phases;
}