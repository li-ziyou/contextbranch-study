import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Workspace } from '../core/workspace';
import { StudyRunFile, StudyUiState } from './types';

/**
 * StudyController is the single source of truth for a prepared Study 2 run.
 * It reads only the operator-generated .study/run.json file. Participants
 * cannot select condition, task, sibling labels, time limit, or budgets.
 */
export class StudyController {
  private readonly runPath: string;
  private constructor(private readonly workspaceRoot: string, private run: StudyRunFile) {
    this.runPath = path.join(workspaceRoot, '.study', 'run.json');
  }

  static load(workspaceRoot: string | undefined): StudyController | null {
    if (!workspaceRoot) return null;
    const runPath = path.join(workspaceRoot, '.study', 'run.json');
    try {
      const run = JSON.parse(fs.readFileSync(runPath, 'utf-8')) as StudyRunFile;
      if (run.schemaVersion !== 1 || !run.runId || !run.taskId || !run.condition) return null;
      return new StudyController(workspaceRoot, run);
    } catch {
      return null;
    }
  }

  get condition(): StudyRunFile['condition'] { return this.run.condition; }
  get isContextBranch(): boolean { return this.run.condition === 'contextbranch'; }
  get taskId(): string { return this.run.taskId; }
  get participantId(): string { return this.run.participantId; }
  get providerName(): StudyRunFile['model']['provider'] { return this.run.model.provider; }
  get modelId(): string { return this.run.model.id; }
  get publicTestCommand(): string { return this.run.manifest.runner.publicTestCommand; }
  get finalState(): string { return this.run.manifest.submission.finalState; }

  initialize(ws: Workspace): void {
    const initialized = ws.storage.loadTelemetry().some(event =>
      event.type === 'study_initialized' && event.runId === this.run.runId
    );
    if (initialized) return;

    const root = ws.getBranch(ws.mainBranchId);
    if (!root) throw new Error('Study workspace has no main state.');
    ws.appendMessage(root.id, 'system', this.rootBriefMessage());
    const siblingIds: string[] = [];
    if (this.isContextBranch) {
      for (const sibling of this.run.manifest.contextBranch.siblingStates) {
        const branch = ws.createBranch({
          name: sibling.label,
          description: `Study implementation area: ${sibling.label}`,
          parentBranchId: ws.mainBranchId,
          tags: ['study-sibling', sibling.id],
        });
        ws.appendMessage(branch.id, 'system',
          `[study] This is the “${sibling.label}” implementation state. ` +
          'It starts with the same task and code as the other state. Use it if useful; work may be compared or integrated later by you.'
        );
        siblingIds.push(branch.id);
      }
      if (siblingIds[0]) ws.switchBranch(siblingIds[0]);
    }
    ws.storage.appendTelemetry({
      type: 'study_initialized',
      runId: this.run.runId,
      taskId: this.run.taskId,
      condition: this.run.condition,
      siblingStateIds: siblingIds,
      rootBriefHash: this.run.manifest.sha256,
    });
  }

  start(ws: Workspace): void {
    if (this.isFinished()) throw new Error('This task has already been finished.');
    if (this.run.startedAt) return;
    this.run.startedAt = new Date().toISOString();
    this.persist();
    ws.storage.appendTelemetry({ type: 'study_started', runId: this.run.runId, taskId: this.run.taskId });
  }

  finish(ws: Workspace, stateBeforeFinalization: string = ws.activeBranchId): void {
    const finishedPath = path.join(this.workspaceRoot, '.study', 'finished.json');
    if (fs.existsSync(finishedPath)) return;
    const event = {
      schemaVersion: 1,
      runId: this.run.runId,
      taskId: this.run.taskId,
      condition: this.run.condition,
      finishedAt: new Date().toISOString(),
      timedOut: this.isTimedOut(),
      finalState: this.run.manifest.submission.finalState,
      activeStateAtFinish: stateBeforeFinalization,
      modelCallsUsed: this.modelCallsUsed(ws),
      modelTokensUsed: this.modelTokensUsed(ws),
      productionFileHashes: this.productionFileHashes(),
    };
    fs.writeFileSync(finishedPath, JSON.stringify(event, null, 2) + '\n', 'utf-8');
    ws.storage.appendTelemetry({ type: 'study_finished', ...event });
  }

  actionError(): string | null {
    if (this.isFinished()) return 'This task has already been finished.';
    if (!this.run.startedAt) return 'Click Start task before using the assistant or test runner.';
    if (this.isTimedOut()) return 'The task time limit has ended. Finish task to submit the main state.';
    return null;
  }

  beginModelCall(ws: Workspace): string | null {
    const actionError = this.actionError();
    if (actionError) return actionError;
    if (this.modelCallsUsed(ws) >= this.run.model.modelCallBudget) {
      return 'The pooled model-call budget for this task has been reached.';
    }
    if (this.modelTokensUsed(ws) >= this.run.model.modelTokenBudget) {
      return 'The pooled model-token budget for this task has been reached.';
    }
    ws.storage.appendTelemetry({ type: 'study_model_call_started', runId: this.run.runId });
    return null;
  }

  recordModelUsage(ws: Workspace, inputTokens: number, outputTokens: number, model: string): void {
    ws.storage.appendTelemetry({
      type: 'study_model_call_completed',
      runId: this.run.runId,
      provider: this.providerName,
      model,
      inputTokens,
      outputTokens,
    });
  }

  recordPublicTest(ws: Workspace, exitCode: number | null, output: string, durationMs: number): void {
    ws.storage.appendTelemetry({
      type: 'study_public_test_run',
      runId: this.run.runId,
      stateId: ws.activeBranchId,
      exitCode,
      durationMs,
      output,
    });
  }

  allowsMerge(sourceBranchId: string, targetBranchId: string, ws: Workspace): boolean {
    if (!this.isContextBranch || targetBranchId !== ws.mainBranchId) return false;
    const source = ws.getBranch(sourceBranchId);
    return source?.status === 'active' && source.tags?.includes('study-sibling') === true;
  }

  uiState(ws: Workspace): StudyUiState {
    const elapsed = this.elapsedSeconds();
    const remaining = this.run.startedAt
      ? Math.max(0, this.run.timeLimitSeconds - elapsed)
      : this.run.timeLimitSeconds;
    const siblings = ws.getAllBranches()
      .filter(branch => branch.tags?.includes('study-sibling'))
      .map(branch => branch.id);
    return {
      active: true,
      runId: this.run.runId,
      taskTitle: this.run.manifest.ticket.summary,
      condition: this.run.condition,
      started: Boolean(this.run.startedAt),
      finished: this.isFinished(),
      timeLimitSeconds: this.run.timeLimitSeconds,
      remainingSeconds: remaining,
      modelCallBudget: this.run.model.modelCallBudget,
      modelCallsUsed: this.modelCallsUsed(ws),
      modelTokenBudget: this.run.model.modelTokenBudget,
      modelTokensUsed: this.modelTokensUsed(ws),
      siblingStateIds: siblings,
    };
  }

  private rootBriefMessage(): string {
    const ticket = this.run.manifest.ticket;
    const labels = this.run.manifest.rootBrief.implementationIntentLabels.map(label => `- ${label}`).join('\n');
    const requirements = ticket.requirements.map(item => `- ${item}`).join('\n');
    return `[study] Task: ${ticket.summary}\n\nRequirements:\n${requirements}\n\nImplementation areas:\n${labels}\n\nUse the task ticket and public tests as the working specification. The implementation areas are available in both conditions; they are not required steps.`;
  }

  private elapsedSeconds(): number {
    if (!this.run.startedAt) return 0;
    return Math.floor((Date.now() - Date.parse(this.run.startedAt)) / 1000);
  }

  private isTimedOut(): boolean {
    return Boolean(this.run.startedAt) && this.elapsedSeconds() >= this.run.timeLimitSeconds;
  }

  private isFinished(): boolean {
    return fs.existsSync(path.join(this.workspaceRoot, '.study', 'finished.json'));
  }

  private modelCallsUsed(ws: Workspace): number {
    return ws.storage.loadTelemetry().filter(event => event.type === 'study_model_call_started' && event.runId === this.run.runId).length;
  }

  private modelTokensUsed(ws: Workspace): number {
    return ws.storage.loadTelemetry()
      .filter(event => event.type === 'study_model_call_completed' && event.runId === this.run.runId)
      .reduce((total, event) => total + Number(event.inputTokens ?? 0) + Number(event.outputTokens ?? 0), 0);
  }

  private productionFileHashes(): Record<string, string> {
    const hashes: Record<string, string> = {};
    for (const relativePath of this.run.manifest.submission.allowedProductionPaths) {
      const file = path.join(this.workspaceRoot, relativePath);
      if (!fs.existsSync(file)) {
        throw new Error(`Required production file is missing at finish: ${relativePath}`);
      }
      hashes[relativePath] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
    return hashes;
  }

  private persist(): void {
    fs.writeFileSync(this.runPath, JSON.stringify(this.run, null, 2) + '\n', 'utf-8');
  }
}
