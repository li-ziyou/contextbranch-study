/**
 * Stable Study 2 contracts. The future StudyController reads these values from
 * a frozen manifest; participants never set them through the VS Code UI.
 */

export type StudyCondition = 'linear' | 'contextbranch';
export type StudyProvider = 'anthropic' | 'openai' | 'openrouter' | 'gemini';

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
    runtime: 'contextbranch-study-python';
    network: 'not-required';
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
  provider: StudyProvider;
  modelId: string;
  modelCallBudget: number;
  modelTokenBudget: number;
}

export interface StudyRunFile {
  schemaVersion: 1;
  runId: string;
  participantId: string;
  sequenceId: string;
  period: 1 | 2;
  taskId: string;
  condition: StudyCondition;
  createdAt: string;
  startedAt: string | null;
  timeLimitSeconds: number;
  model: {
    provider: StudyProvider;
    id: string;
    modelCallBudget: number;
    modelTokenBudget: number;
  };
  manifest: {
    taskId: string;
    sha256: string;
    ticket: { summary: string; requirements: string[] };
    rootBrief: StudyTaskManifest['rootBrief'];
    contextBranch: StudyTaskManifest['contextBranch'];
    runner: StudyTaskManifest['runner'];
    submission: StudyTaskManifest['submission'];
  };
}

export interface StudyUiState {
  active: boolean;
  runId: string;
  taskTitle: string;
  condition: StudyCondition;
  started: boolean;
  finished: boolean;
  timeLimitSeconds: number;
  remainingSeconds: number;
  modelCallBudget: number;
  modelCallsUsed: number;
  modelTokenBudget: number;
  modelTokensUsed: number;
  siblingStateIds: string[];
}
