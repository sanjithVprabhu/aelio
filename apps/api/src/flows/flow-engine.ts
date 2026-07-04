export interface FlowStep {
  order: number;
  toolKey?: string;
  prompt?: string;
}

export interface FlowDefinition {
  id: string;
  objectiveKey: string;
  stateKey: string;
  steps: FlowStep[];
}

export interface FlowProgress {
  flowId: string;
  objectiveKey: string;
  currentStep: number;
  completedSteps: number[];
}

export function findFlowForObjective(
  flows: FlowDefinition[],
  stateKey: string,
  objectiveKey: string,
): FlowDefinition | undefined {
  return flows.find((f) => f.stateKey === stateKey && f.objectiveKey === objectiveKey);
}

export function nextFlowStep(flow: FlowDefinition, progress?: FlowProgress): FlowStep | undefined {
  const done = new Set(progress?.completedSteps ?? []);
  return [...flow.steps].sort((a, b) => a.order - b.order).find((s) => !done.has(s.order));
}

export function advanceFlow(progress: FlowProgress, stepOrder: number): FlowProgress {
  const completed = new Set(progress.completedSteps);
  completed.add(stepOrder);
  const next = nextFlowStep(
    { id: progress.flowId, objectiveKey: progress.objectiveKey, stateKey: '', steps: [] },
    { ...progress, completedSteps: [...completed] },
  );
  return {
    ...progress,
    completedSteps: [...completed],
    currentStep: next?.order ?? stepOrder,
  };
}

export function buildFlowGuidanceBlock(
  flow: FlowDefinition | undefined,
  step: FlowStep | undefined,
): string | undefined {
  if (!flow || !step) return undefined;
  const lines = flow.steps
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      const mark = s.order === step.order ? '→' : ' ';
      return `${mark} ${s.order}. ${s.prompt ?? s.toolKey ?? 'step'}`;
    });
  return `\n\n## Active flow (enforce order)\nObjective: ${flow.objectiveKey}\n${lines.join('\n')}`;
}

/** Resolve the active playbook for the next incomplete objective in a state. */
export function resolveActiveFlow(
  flows: FlowDefinition[],
  stateKey: string,
  completedObjectiveKeys: string[],
  objectives: Array<{ key: string }> | undefined,
): { flow: FlowDefinition; step: FlowStep | undefined } | null {
  const remaining = objectives?.filter((o) => !completedObjectiveKeys.includes(o.key)) ?? [];
  const nextObjective = remaining[0];
  if (!nextObjective) return null;
  const flow = findFlowForObjective(flows, stateKey, nextObjective.key);
  if (!flow) return null;
  return { flow, step: nextFlowStep(flow) };
}