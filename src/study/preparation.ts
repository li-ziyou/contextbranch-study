import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { StudyRunFile } from './types';

export interface StudySession {
  schemaVersion: 1;
  participantId: string;
  group: 'G1' | 'G2' | 'G3' | 'G4';
  createdAt: string;
  extensionVersion: string;
  sourceRevision: string;
  assetsHash: string;
  timeLimitSeconds: number;
  model: StudyRunFile['model'];
  environment: Record<string, string>;
  periods: { period: 1 | 2; runId: string; workspace: string }[];
}
export interface StudyAssetIndex {
  schemaVersion: 1;
  extensionVersion: string;
  sourceRevision: string;
  files: Record<string, string>;
  taskSet: {
    taskSetId: string;
    testFormIds: string[];
    taskIds: string[];
    sequences: { id: string; period1: { taskId: string; condition: StudyRunFile['condition'] }; period2: { taskId: string; condition: StudyRunFile['condition'] } }[];
  };
}
export const hashBytes = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');
export function safeRelative(value: string): boolean {
  return Boolean(value) && !/^[A-Za-z]:/.test(value) && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
}
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
}
export function verifyStudyAssets(assetRoot: string): StudyAssetIndex {
  const index = JSON.parse(fs.readFileSync(path.join(assetRoot, 'index.json'), 'utf8')) as StudyAssetIndex;
  if (index.schemaVersion !== 1 || index.taskSet.taskSetId !== 'study2-v2' || index.taskSet.sequences.length !== 4) throw new Error('The study assets are invalid. Reinstall the study VSIX.');
  for (const [relative, expected] of Object.entries(index.files)) {
    if (!safeRelative(relative)) throw new Error('Invalid study asset path.');
    const file = path.join(assetRoot, relative);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || hashBytes(fs.readFileSync(file)) !== expected) throw new Error(`Study asset changed: ${relative}. Reinstall the study VSIX.`);
  }
  return index;
}
export function prepareStudySession(options: {
  assets: string; parent: string; participantId: string; group: StudySession['group']; runtimePython: string;
  model?: StudyRunFile['model']; environment?: Record<string, string>;
}): { directory: string; session: StudySession } {
  if (!/^P\d{3,}$/.test(options.participantId)) throw new Error('Use a participant ID such as P001.');
  if (!/^G[1-4]$/.test(options.group)) throw new Error('Choose G1, G2, G3, or G4.');
  if (!fs.existsSync(options.runtimePython)) throw new Error('The study Python environment is missing.');
  const index = verifyStudyAssets(options.assets);
  const createdAt = new Date().toISOString();
  const directory = path.join(options.parent, `${options.participantId}_${createdAt.replace(/[-:.]/g, '')}_${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(directory, { recursive: true });
  const session: StudySession = {
    schemaVersion: 1, participantId: options.participantId, group: options.group, createdAt,
    extensionVersion: index.extensionVersion, sourceRevision: index.sourceRevision,
    assetsHash: hashBytes(fs.readFileSync(path.join(options.assets, 'index.json'))),
    timeLimitSeconds: 1200, model: options.model ?? { provider: 'openrouter', id: 'google/gemini-2.5-flash-lite' }, environment: options.environment ?? { platform: process.platform, arch: process.arch, node: process.versions.node }, periods: [],
  };
  const sequence = index.taskSet.sequences[Number(options.group.slice(1)) - 1];
  for (const period of [1, 2] as const) {
    const assignment = period === 1 ? sequence.period1 : sequence.period2;
    const taskRoot = path.join(options.assets, 'tasks', assignment.taskId);
    const full = JSON.parse(fs.readFileSync(path.join(taskRoot, 'manifest.json'), 'utf8'));
    const runId = `${options.participantId}-period${period}-${assignment.taskId}-${assignment.condition}`;
    const runDirectory = path.join(directory, runId);
    const workspace = path.join(runDirectory, 'workspace');
    fs.cpSync(path.join(taskRoot, 'baseline'), workspace, { recursive: true, errorOnExist: true, force: false });
    fs.cpSync(path.join(taskRoot, 'tests'), path.join(workspace, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(workspace, '.study/bin'), { recursive: true });
    fs.copyFileSync(path.join(options.assets, 'runner/study_runner.py'), path.join(workspace, '.study/bin/study_runner.py'));
    fs.copyFileSync(path.join(taskRoot, 'TASK.md'), path.join(workspace, '.study/TASK.md'));
    const ticket = { ...full.ticket, mainMarkdown: fs.readFileSync(path.join(taskRoot, 'TASK.md'), 'utf8') };
    const run: StudyRunFile = {
      schemaVersion: 1, runId, participantId: options.participantId, taskSetId: 'study2-v2', sequenceId: sequence.id,
      period, taskId: assignment.taskId, formId: index.taskSet.testFormIds[crypto.randomInt(index.taskSet.testFormIds.length)],
      condition: assignment.condition, createdAt, startedAt: null,
      exportDirectory: path.join(directory, 'participant-exports'), sessionDirectory: directory,
      timeLimitSeconds: session.timeLimitSeconds, model: session.model, runtimePython: options.runtimePython,
      manifest: { taskId: assignment.taskId, sha256: hashBytes(fs.readFileSync(path.join(taskRoot, 'manifest.json'))), ticket, contextBranch: full.contextBranch, runner: full.runner, submission: full.submission },
    };
    writeJsonAtomic(path.join(workspace, '.study/run.json'), run);
    writeJsonAtomic(path.join(workspace, '.study/task.json'), { schemaVersion: 1, taskId: run.taskId, participantTitle: full.participantTitle, ticket, runner: full.runner, submission: full.submission });
    writeJsonAtomic(path.join(runDirectory, 'run.json'), run);
    writeJsonAtomic(path.join(workspace, '.vscode/settings.json'), {
      'window.title': `${run.participantId} · Task ${period} of 2 · ${full.participantTitle} · ${run.condition === 'linear' ? 'Linear' : 'ContextBranch'}\${separator}\${appName}`,
      'contextbranch.studyMode': true, 'contextbranch.participantId': run.participantId,
      'contextbranch.condition': run.condition, 'contextbranch.model': run.model.id,
      'contextbranch.metaAgentEnabled': false, 'contextbranch.semanticMerge': false,
      'contextbranch.autoApplyOnSwitch': true, 'contextbranch.captureUserEdits': true,
      'contextbranch.captureNewFiles': true, 'contextbranch.reviewEdits': true,
      'python.defaultInterpreterPath': options.runtimePython,
    });
    session.periods.push({ period, runId, workspace: path.relative(directory, workspace).split(path.sep).join('/') });
  }
  writeJsonAtomic(path.join(directory, 'session.json'), session);
  return { directory, session };
}
