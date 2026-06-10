export enum OnboardingStep {
  ConnectAPI = 'connect_api',
  ReviewActions = 'review_actions',
  ConfigureIdentity = 'configure_identity',
  ConnectChannel = 'connect_channel',
  ReviewPlaybook = 'review_playbook',
  TestBot = 'test_bot',
  GoLive = 'go_live',
  Complete = 'complete',
}

export interface OnboardingState {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  specId?: string;
  channelId?: string;
  playbookId?: string;
  testSessionId?: string;
  updatedAt: Date;
}
