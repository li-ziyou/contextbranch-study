#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studyRoot = path.resolve(here, '..');
const manifestsDir = path.join(studyRoot, 'manifests');
const sequencesPath = path.join(here, 'assignment-sequences.json');
const repoRoot = path.resolve(studyRoot, '..', '..');
const defaultBundlesRoot = path.join(repoRoot, 'participant-bundles');
const defaultRunsRoot = path.join(studyRoot, 'runs');
const runtimeRoot = path.join(repoRoot, '.study-runtime');
const builderRoot = path.join(repoRoot, '.study-builder');
const requiredManifestFields = [
  'schemaVersion', 'taskId', 'participantTitle', 'provenance', 'assets',
  'ticket', 'rootBrief', 'contextBranch', 'runner', 'submission', 'privateGrader',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function manifestFiles() {
  return fs.readdirSync(manifestsDir)
    .filter(name => name.endsWith('.json') && name !== 'task-manifest.schema.json')
    .sort()
    .map(name => path.join(manifestsDir, name));
}

function validate() {
  const failures = [];
  const seen = new Set();
  for (const file of manifestFiles()) {
    const manifest = readJson(file);
    for (const field of requiredManifestFields) {
      if (!(field in manifest)) failures.push(`${path.basename(file)}: missing ${field}`);
    }
    if (seen.has(manifest.taskId)) failures.push(`${path.basename(file)}: duplicate taskId ${manifest.taskId}`);
    seen.add(manifest.taskId);
    if (manifest.contextBranch?.siblingStates?.length !== 2) {
      failures.push(`${path.basename(file)}: requires exactly two sibling states`);
    }
    if (manifest.runner?.publicTestCommand?.includes('private')) {
      failures.push(`${path.basename(file)}: public command must not expose private grader`);
    }
    if (manifest.provenance?.type !== 'FeatureBench-derived curated study task') {
      failures.push(`${path.basename(file)}: must identify its curated FeatureBench-derived provenance`);
    }
    if (!manifest.provenance?.sourceInstanceId || !manifest.provenance?.sourceCommit) {
      failures.push(`${path.basename(file)}: requires a pinned FeatureBench source instance and commit`);
    }
    for (const asset of ['baselineDirectory', 'referenceDirectory']) {
      const assetPath = path.join(studyRoot, manifest.assets?.[asset] ?? '');
      if (!manifest.assets?.[asset] || !fs.existsSync(assetPath)) {
        failures.push(`${path.basename(file)}: missing ${asset}`);
      }
    }
    if (manifest.runner?.runtime !== 'contextbranch-study-python') {
      failures.push(`${path.basename(file)}: requires the Study Python runtime`);
    }
    if (!Array.isArray(manifest.submission?.allowedProductionPaths) || manifest.submission.allowedProductionPaths.length === 0) {
      failures.push(`${path.basename(file)}: requires an allowlisted production path`);
    }
    if (new Set(manifest.submission?.allowedProductionPaths ?? []).size !== 2) {
      failures.push(`${path.basename(file)}: requires exactly two independent production paths`);
    }
    if (!Array.isArray(manifest.privateGrader?.hiddenGoals) || manifest.privateGrader.hiddenGoals.length !== 3) {
      failures.push(`${path.basename(file)}: requires exactly three private behavioural goals`);
    }
  }
  if (seen.size !== 2) failures.push(`expected two task manifests, found ${seen.size}`);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Validated ${seen.size} Study 2 manifests.`);
}

function assign(participantId) {
  if (!/^P\d{3,}$/.test(participantId ?? '')) {
    throw new Error('Use a pseudonymous participant ID such as P017.');
  }
  const participantNumber = Number.parseInt(participantId.slice(1), 10);
  const sequence = assignmentFor(participantNumber);
  console.log(JSON.stringify({ participantId, sequence }, null, 2));
}

function assignmentFor(participantNumber) {
  const sequences = readJson(sequencesPath).sequences;
  return sequences[(participantNumber - 1) % sequences.length];
}

function parseOptions(args) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { positional, options };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function participantNumber(participantId) {
  if (!/^P\d{3,}$/.test(participantId ?? '')) {
    throw new Error('Use a pseudonymous participant ID such as P017.');
  }
  return Number.parseInt(participantId.slice(1), 10);
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function studyProvider(value) {
  if (!['anthropic', 'openai', 'openrouter', 'gemini'].includes(value)) {
    throw new Error('Provider must be one of: anthropic, openai, openrouter, gemini.');
  }
  return value;
}

function cpDirectory(from, to, filter) {
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, filter });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function utcFolderTimestamp(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function studyProfile(runsRoot, options) {
  const profilePath = path.join(runsRoot, 'study-profile.json');
  if (fs.existsSync(profilePath)) {
    const profile = readJson(profilePath);
    const provided = {
      provider: options.provider,
      modelId: options.model,
      timeLimitSeconds: options['time-limit'] ? positiveInteger(options['time-limit'], 'time limit') : undefined,
      modelCallBudget: options['model-calls'] ? positiveInteger(options['model-calls'], 'model-call budget') : undefined,
      modelTokenBudget: options['model-tokens'] ? positiveInteger(options['model-tokens'], 'model-token budget') : undefined,
    };
    for (const [key, value] of Object.entries(provided)) {
      if (value !== undefined && value !== profile[key]) {
        throw new Error(`Prepared study profile fixes ${key}; the supplied value does not match.`);
      }
    }
    return profile;
  }
  if (!options.model || !options.provider) {
    throw new Error('The first prepared run requires --provider FIXED_PROVIDER --model FIXED_MODEL.');
  }
  const profile = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    provider: studyProvider(options.provider),
    modelId: options.model,
    timeLimitSeconds: positiveInteger(options['time-limit'] ?? '1500', 'time limit'),
    modelCallBudget: positiveInteger(options['model-calls'] ?? '20', 'model-call budget'),
    modelTokenBudget: positiveInteger(options['model-tokens'] ?? '120000', 'model-token budget'),
  };
  fs.mkdirSync(runsRoot, { recursive: true });
  writeJson(profilePath, profile);
  return profile;
}

function sessionRootFor(runsRoot, profile, participantId) {
  const profilePath = path.join(runsRoot, 'study-profile.json');
  const sessions = profile.sessions ?? {};
  if (sessions[participantId]) return path.join(runsRoot, sessions[participantId]);

  const timestamp = utcFolderTimestamp();
  const baseName = `${participantId}_${timestamp}`;
  let sessionName = baseName;
  let duplicate = 2;
  while (fs.existsSync(path.join(runsRoot, sessionName))) {
    sessionName = `${baseName}-${duplicate}`;
    duplicate += 1;
  }
  profile.sessions = { ...sessions, [participantId]: sessionName };
  writeJson(profilePath, profile);
  return path.join(runsRoot, sessionName);
}

function findRunDirectory(runsRoot, runId) {
  const legacyDirectory = path.join(runsRoot, runId);
  if (fs.existsSync(legacyDirectory)) return legacyDirectory;

  const candidates = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(runsRoot, entry.name, runId))
    .filter(candidate => fs.existsSync(candidate));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`More than one prepared run matches ${runId}; specify a separate runs directory.`);
  }
  throw new Error(`Prepared run not found: ${runId}`);
}

function prepare(participantId, periodText, options) {
  const number = participantNumber(participantId);
  const period = Number.parseInt(periodText, 10);
  if (![1, 2].includes(period)) throw new Error('Period must be 1 or 2.');
  const sequence = assignmentFor(number);
  const assignment = sequence[`period${period}`];
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const runsRoot = path.resolve(options.runs ?? defaultRunsRoot);
  const participantBundle = path.join(bundlesRoot, assignment.taskId, 'participant');
  if (!fs.existsSync(participantBundle)) {
    throw new Error(`Task bundle missing: ${participantBundle}. Run npm run study:build-tasks first.`);
  }
  const profile = studyProfile(runsRoot, options);
  const runtimePython = path.join(runtimeRoot, 'bin', 'python');
  if (!fs.existsSync(runtimePython)) {
    throw new Error(`Study Python runtime is missing (${runtimePython}). Run npm run study:setup-runtime first.`);
  }
  const manifestPath = path.join(manifestsDir, `${assignment.taskId}.json`);
  const manifest = readJson(manifestPath);
  const runId = `${participantId}-period${period}-${assignment.taskId}-${assignment.condition}`;
  const sessionRoot = sessionRootFor(runsRoot, profile, participantId);
  const runDir = path.join(sessionRoot, runId);
  if (fs.existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  const workspace = path.join(runDir, 'workspace');
  fs.mkdirSync(runDir, { recursive: true });
  cpDirectory(participantBundle, workspace, source => !source.includes(`${path.sep}.contextbranch${path.sep}`));

  const run = {
    schemaVersion: 1,
    runId,
    participantId,
    sequenceId: sequence.id,
    period,
    taskId: assignment.taskId,
    condition: assignment.condition,
    createdAt: new Date().toISOString(),
    startedAt: null,
    exportDirectory: path.join(sessionRoot, 'participant-exports'),
    timeLimitSeconds: profile.timeLimitSeconds,
    model: {
      provider: profile.provider,
      id: profile.modelId,
      modelCallBudget: profile.modelCallBudget,
      modelTokenBudget: profile.modelTokenBudget,
    },
    // The prepared run is portable across the participant workspace location:
    // the runtime path is generated on the current machine rather than guessed
    // from /tmp or hard-coded to an operator's home directory.
    runtimePython: path.resolve(runtimePython),
    manifest: {
      taskId: manifest.taskId,
      sha256: sha256File(manifestPath),
      ticket: manifest.ticket,
      rootBrief: manifest.rootBrief,
      contextBranch: manifest.contextBranch,
      runner: manifest.runner,
      submission: manifest.submission,
    },
  };
  const studyDir = path.join(workspace, '.study');
  writeJson(path.join(studyDir, 'run.json'), run);
  const vscodeDir = path.join(workspace, '.vscode');
  fs.mkdirSync(vscodeDir, { recursive: true });
  const settings = {
    'contextbranch.studyMode': true,
    'contextbranch.participantId': participantId,
    'contextbranch.condition': assignment.condition,
    'contextbranch.model': run.model.id,
    'contextbranch.testCommand': manifest.runner.publicTestCommand,
    'contextbranch.metaAgentEnabled': false,
    'contextbranch.semanticMerge': false,
    'contextbranch.autoApplyOnSwitch': true,
    'contextbranch.captureUserEdits': true,
    'contextbranch.captureNewFiles': true,
    'contextbranch.reviewEdits': true,
  };
  writeJson(path.join(vscodeDir, 'settings.json'), settings);
  writeJson(path.join(runDir, 'run.json'), run);
  console.log(JSON.stringify({ runId, sessionRoot, workspace, taskId: assignment.taskId, condition: assignment.condition, profile }, null, 2));
}

function collect(runId, options) {
  const runsRoot = path.resolve(options.runs ?? defaultRunsRoot);
  const runDir = findRunDirectory(runsRoot, runId);
  const workspace = path.join(runDir, 'workspace');
  const finishedPath = path.join(workspace, '.study', 'finished.json');
  if (!fs.existsSync(finishedPath)) {
    throw new Error('The extension has not recorded a finished main state for this run.');
  }
  const finished = readJson(finishedPath);
  if (finished.finalState !== 'main') throw new Error('Finish record does not identify main as the final state.');
  const run = readJson(path.join(runDir, 'run.json'));
  const expectedHashes = finished.productionFileHashes;
  if (!expectedHashes || typeof expectedHashes !== 'object') {
    throw new Error('Finish record has no production-file hashes; use the current study extension to finish the task.');
  }
  for (const relativePath of run.manifest.submission.allowedProductionPaths) {
    const file = path.join(workspace, relativePath);
    if (!fs.existsSync(file) || expectedHashes[relativePath] !== sha256File(file)) {
      throw new Error(`Workspace changed after Finish task: ${relativePath}`);
    }
  }
  const destination = path.join(runDir, 'submission', 'main');
  if (fs.existsSync(destination)) throw new Error(`Submission already collected: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  cpDirectory(workspace, destination, source => {
    const basename = path.basename(source);
    return basename !== '.git' && basename !== '.contextbranch';
  });
  const telemetrySource = path.join(workspace, '.contextbranch');
  const telemetryDestination = path.join(runDir, 'telemetry');
  if (fs.existsSync(telemetrySource)) cpDirectory(telemetrySource, telemetryDestination, () => true);
  fs.writeFileSync(path.join(runDir, 'collection.json'), JSON.stringify({
    runId,
    collectedAt: new Date().toISOString(),
    finalState: finished.finalState,
    startedAt: finished.startedAt,
    finishedAt: finished.finishedAt,
    durationMs: finished.durationMs,
    submission: destination,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ runId, submission: destination, telemetry: fs.existsSync(telemetryDestination) ? telemetryDestination : null }, null, 2));
}

function preflight(options) {
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const failures = [];
  for (const manifestFile of manifestFiles()) {
    const manifest = readJson(manifestFile);
    const workspace = path.join(bundlesRoot, manifest.taskId, 'participant');
    if (!fs.existsSync(path.join(workspace, '.study', 'task.json'))) {
      failures.push(`${manifest.taskId}: participant bundle is missing`);
      continue;
    }
    for (const relativePath of manifest.submission.allowedProductionPaths) {
      if (!fs.existsSync(path.join(workspace, relativePath))) {
        failures.push(`${manifest.taskId}: participant bundle is missing ${relativePath}`);
      }
    }
    if (!fs.existsSync(path.join(bundlesRoot, manifest.taskId, 'private', 'reference'))) {
      failures.push(`${manifest.taskId}: private reference repair is missing`);
    }
  }
  const python = path.join(runtimeRoot, 'bin', 'python');
  if (!fs.existsSync(python)) {
    failures.push(`Study Python runtime is missing (${python}). Run npm run study:setup-runtime.`);
  } else {
    try {
      execFileSync(python, ['-c', 'import click, numpy, pytest, yaml'], { stdio: 'ignore' });
    } catch {
      failures.push('Study Python runtime is missing a required package');
    }
  }
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Study preflight passed: bundles and the Study Python runtime are ready.');
}

function setupRuntime() {
  const python = process.env.PYTHON ?? 'python3';
  const requirements = path.join(studyRoot, 'runner', 'requirements.txt');
  if (!fs.existsSync(path.join(runtimeRoot, 'bin', 'python'))) {
    execFileSync(python, ['-m', 'venv', runtimeRoot], { stdio: 'inherit' });
  }
  execFileSync(path.join(runtimeRoot, 'bin', 'python'), ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
  execFileSync(path.join(runtimeRoot, 'bin', 'python'), ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
  console.log(`Study Python runtime ready: ${path.join(runtimeRoot, 'bin', 'python')}`);
}

function dryRun(options) {
  preflight(options);
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const runtimePython = path.join(runtimeRoot, 'bin', 'python');
  for (const manifestFile of manifestFiles()) {
    const manifest = readJson(manifestFile);
    const bundle = path.join(bundlesRoot, manifest.taskId);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `contextbranch-study-${manifest.taskId}-`));
    try {
      const workspace = path.join(scratch, 'workspace');
      cpDirectory(path.join(bundle, 'participant'), workspace, () => true);
      for (const relativePath of manifest.submission.allowedProductionPaths) {
        const source = path.join(bundle, 'private', 'reference', relativePath);
        const target = path.join(workspace, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
      }
      execFileSync('python3', ['.study/bin/study_runner.py', 'public', '--workspace', '.'], {
        cwd: workspace,
        stdio: 'inherit',
        env: { ...process.env, CONTEXTBRANCH_STUDY_PYTHON: runtimePython },
      });
      execFileSync(runtimePython, [
        path.join(studyRoot, 'private-grader', 'grade_submission.py'),
        '--bundle', bundle,
        '--submission', workspace,
        '--result', path.join(scratch, 'grade.json'),
      ], {
        stdio: 'inherit',
        env: { ...process.env, CONTEXTBRANCH_STUDY_PYTHON: runtimePython },
      });
      console.log(`Dry run passed: ${manifest.taskId}`);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function buildTasks() {
  const python = process.env.PYTHON ?? 'python3';
  const requirements = path.join(studyRoot, 'task-builder', 'requirements.txt');
  const builder = path.join(studyRoot, 'task-builder', 'build_task.py');
  const builderPython = path.join(builderRoot, 'bin', 'python');
  if (!fs.existsSync(builderPython)) {
    execFileSync(python, ['-m', 'venv', builderRoot], { stdio: 'inherit' });
  }
  execFileSync(builderPython, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
  execFileSync(builderPython, [builder, '--all'], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`Study task bundles ready: ${defaultBundlesRoot}`);
}

const [commandName, ...rest] = process.argv.slice(2);
const { positional, options } = parseOptions(rest);
if (commandName === 'validate') validate();
else if (commandName === 'assign') assign(positional[0]);
else if (commandName === 'prepare') prepare(positional[0], positional[1], options);
else if (commandName === 'collect') collect(positional[0], options);
else if (commandName === 'preflight') preflight(options);
else if (commandName === 'setup-runtime') setupRuntime();
else if (commandName === 'build-tasks') buildTasks();
else if (commandName === 'dry-run') dryRun(options);
else {
  console.error('Usage: studyctl.mjs validate | assign P017 | prepare P017 1 | collect RUN_ID | preflight | setup-runtime | build-tasks | dry-run');
  process.exitCode = 1;
}
