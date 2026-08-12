/**
 * Stable Study 2 contracts. The future StudyController reads these values from
 * a frozen manifest; participants never set them through the VS Code UI.
 */

export type StudyCondition = 'linear' | 'contextbranch';
export type StudyProvider = 'anthropic' | 'openai' | 'openrouter' | 'gemini';

export interface StudySiblingState {
  id: string;
  label: string;
  ticket: {
    goal: string;
    requirements: string[];
    validation: string;
  };
}

export interface StudyMergeRouteStep {
  stateId: string;
  instruction: string;
}

export interface StudyTaskManifest {
  schemaVersion: 1;
  taskId: string;
  participantTitle: string;
  contextBranch: {
    siblingStates: [StudySiblingState, StudySiblingState];
    recommendedMergeRoute: [StudyMergeRouteStep, StudyMergeRouteStep];
    finalVerification: string;
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
  /** Shared folder containing one ZIP per completed task in this session. */
  exportDirectory?: string;
  timeLimitSeconds: number;
  model: {
    provider: StudyProvider;
    id: string;
    modelCallBudget: number;
    modelTokenBudget: number;
  };
  /** Absolute path to the study Python runtime generated during prepare. */
  runtimePython: string;
  manifest: {
    taskId: string;
    sha256: string;
    ticket: { summary: string; requirements: string[] };
    contextBranch: StudyTaskManifest['contextBranch'];
    runner: StudyTaskManifest['runner'];
    submission: StudyTaskManifest['submission'];
  };
}

export interface StudyFinishedRecord {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  condition: StudyCondition;
  startedAt: string | null;
  finishedAt: string;
  durationMs: number;
  timedOut: boolean;
  finalState: 'main';
  activeStateAtFinish: string;
  modelCallsUsed: number;
  modelTokensUsed: number;
  productionFileHashes: Record<string, string>;
}

export interface StudyArchive {
  filePath: string;
  fileName: string;
  created: boolean;
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
