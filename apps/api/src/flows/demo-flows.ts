import type { FlowDefinition } from './flow-engine.js';

export const DEMO_FLOWS: FlowDefinition[] = [
  {
    id: 'onboarding_choose_plan',
    stateKey: 'onboarding',
    objectiveKey: 'choose_plan',
    steps: [
      { order: 1, prompt: 'Ask which plan fits their team size and usage.' },
      { order: 2, toolKey: 'get_account_status' },
      { order: 3, toolKey: 'update_plan' },
      { order: 4, prompt: 'Confirm the plan change and next steps.' },
    ],
  },
  {
    id: 'churn_retention',
    stateKey: 'churn',
    objectiveKey: 'offer_retention',
    steps: [
      { order: 1, prompt: 'Acknowledge cancellation intent and ask what went wrong.' },
      { order: 2, toolKey: 'get_account_status' },
      { order: 3, toolKey: 'update_plan' },
      { order: 4, prompt: 'Summarize retention offer.' },
    ],
  },
];