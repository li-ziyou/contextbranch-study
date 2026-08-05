/**
 * Stable Study 2 contracts. The future StudyController reads these values from
 * a frozen manifest; participants never set them through the VS Code UI.
 */

export type StudyCondition = 'linear' | 'contextbranch';

export interface StudySiblingState {
  id: string;
  label: string;
}

export interface StudyTaskManifest {
  schemaVersion: 1;
  taskId: string;
  participantTitle: string;
  rootBrief: {
    visibleInBothConditions: true;
    implementationIntentLabels: [string, string];
  };
  contextBranch: {
    siblingStates: [StudySiblingState, StudySiblingState];
  };
  runner: {
    publicTestCommand: string;
    image: string;
    network: 'none';
  };
  submission: {
    allowedProductionPaths: string[];
    finalState: 'main';
  };
}

export interface StudyRunConfig {
  runId: string;
  participantId: string;
  period: 1 | 2;
  condition: StudyCondition;
  manifestPath: string;
  timeLimitSeconds: number;
  modelId: string;
  modelCallBudget: number;
  modelTokenBudget: number;
}
