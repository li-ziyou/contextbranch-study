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
const taskSetsDir = path.join(here, 'task-sets');
const defaultTaskSetId = 'study2-v2';
const repoRoot = path.resolve(studyRoot, '..', '..');
const defaultBundlesRoot = path.join(repoRoot, 'participant-bundles');
const defaultRunsRoot = path.join(studyRoot, 'runs');
const runtimeRoot = path.join(repoRoot, '.study-runtime');
const builderRoot = path.join(repoRoot, '.study-builder');
const isWindows = process.platform === 'win32';
const requiredManifestFields = [
  'schemaVersion', 'taskId', 'participantTitle', 'provenance', 'assets',
  'ticket', 'contextBranch', 'runner', 'submission', 'privateGrader',
];

function venvPython(root) {
  return path.join(root, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
}

function systemPython() {
  if (process.env.PYTHON) return { command: process.env.PYTHON, prefixArgs: [] };
  return isWindows
    ? { command: 'py', prefixArgs: ['-3'] }
    : { command: 'python3', prefixArgs: [] };
}

function createVenv(root) {
  const { command, prefixArgs } = systemPython();
  execFileSync(command, [...prefixArgs, '-m', 'venv', root], { stdio: 'inherit' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function taskSet(taskSetId = defaultTaskSetId) {
  const safeId = String(taskSetId);
  if (!/^[a-z0-9-]+$/.test(safeId)) throw new Error(`Invalid task set: ${safeId}`);
  const file = path.join(taskSetsDir, `${safeId}.json`);
  if (!fs.existsSync(file)) throw new Error(`Unknown task set: ${safeId}`);
  const value = readJson(file);
  if (value.schemaVersion !== 1 || value.taskSetId !== safeId || !Array.isArray(value.taskIds) || value.taskIds.length !== 2 ||
      !Array.isArray(value.testFormIds) || value.testFormIds.length === 0) {
    throw new Error(`Invalid task-set configuration: ${file}`);
  }
  return value;
}

function selectedTaskSet(options = {}) {
  return taskSet(options['task-set'] ?? process.env.CONTEXTBRANCH_STUDY_TASK_SET ?? defaultTaskSetId);
}

function manifestFiles(selected = null) {
  const allowed = selected ? new Set(selected.taskIds) : null;
  return fs.readdirSync(manifestsDir)
    .filter(name => name.endsWith('.json') && name !== 'task-manifest.schema.json')
    .filter(name => !allowed || allowed.has(name.slice(0, -'.json'.length)))
    .sort()
    .map(name => path.join(manifestsDir, name));
}

function validate(options) {
  const selected = selectedTaskSet(options);
  const failures = [];
  const seen = new Set();
  for (const file of manifestFiles(selected)) {
    const manifest = readJson(file);
    for (const field of requiredManifestFields) {
      if (!(field in manifest)) failures.push(`${path.basename(file)}: missing ${field}`);
    }
    if (seen.has(manifest.taskId)) failures.push(`${path.basename(file)}: duplicate taskId ${manifest.taskId}`);
    seen.add(manifest.taskId);
    const siblings = manifest.contextBranch?.siblingStates;
    if (siblings?.length !== 2) {
      failures.push(`${path.basename(file)}: requires exactly two sibling states`);
    } else {
      const siblingIds = new Set();
      for (const sibling of siblings) {
        if (siblingIds.has(sibling.id)) failures.push(`${path.basename(file)}: sibling state IDs must be unique`);
        siblingIds.add(sibling.id);
        const ticket = sibling.ticket;
        if (!sibling.id || !sibling.label || !Array.isArray(ticket?.requirements) || ticket.requirements.length === 0) {
          failures.push(`${path.basename(file)}: every sibling state requires a complete branch-specific ticket`);
        }
      }
      if (!manifest.contextBranch.finalVerification) {
        failures.push(`${path.basename(file)}: requires final verification guidance`);
      }
    }
    if (manifest.runner?.publicTestCommand?.includes('private')) {
      failures.push(`${path.basename(file)}: public command must not expose private grader`);
    }
    for (const command of Object.values(manifest.runner?.publicTestCommands ?? {})) {
      if (typeof command !== 'string' || command.includes('private')) {
        failures.push(`${path.basename(file)}: contextual public commands must be safe public commands`);
      }
    }
    if (manifest.provenance?.type !== 'FeatureBench-derived curated study task') {
      failures.push(`${path.basename(file)}: must identify its curated FeatureBench-derived provenance`);
    }
    if (!manifest.provenance?.sourceInstanceId || !manifest.provenance?.sourceCommit) {
      failures.push(`${path.basename(file)}: requires a pinned FeatureBench source instance and commit`);
    }
    if (manifest.ticket?.mainTicketFile) {
      const ticketPath = path.resolve(studyRoot, manifest.ticket.mainTicketFile);
      const tasksRoot = path.resolve(studyRoot, 'tasks');
      if (!ticketPath.startsWith(tasksRoot + path.sep) || !fs.existsSync(ticketPath)) {
        failures.push(`${path.basename(file)}: missing main ticket source`);
      } else {
        const mainText = fs.readFileSync(ticketPath, 'utf8');
        for (const sibling of siblings ?? []) {
          for (const requirement of sibling.ticket.requirements ?? []) {
            if (!mainText.includes(requirement)) failures.push(`${path.basename(file)}: branch requirement is not copied from the main ticket: ${requirement}`);
          }
        }
      }
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
  if (seen.size !== 2 || selected.taskIds.some(taskId => !seen.has(taskId))) {
    failures.push(`task set ${selected.taskSetId} must resolve to exactly its two configured manifests`);
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Validated task set ${selected.taskSetId}: ${[...seen].join(', ')}.`);
}

function assign(participantId, options) {
  if (!/^P\d{3,}$/.test(participantId ?? '')) {
    throw new Error('Use a pseudonymous participant ID such as P017.');
  }
  const participantNumber = Number.parseInt(participantId.slice(1), 10);
  const selected = selectedTaskSet(options);
  const group = groupNumber(options.group, selected);
  const sequence = assignmentFor(participantNumber, selected, group);
  console.log(JSON.stringify({ participantId, group, taskSetId: selected.taskSetId, sequence }, null, 2));
}

function groupNumber(value, selected) {
  if (value === undefined) return undefined;
  const normalized = String(value).replace(/^G/i, '');
  const group = Number.parseInt(normalized, 10);
  if (!Number.isInteger(group) || group < 1 || group > selected.sequences.length) {
    throw new Error(`Group must be G1 through G${selected.sequences.length}.`);
  }
  return group;
}

function assignmentFor(participantNumber, selected, group) {
  const sequences = selected.sequences;
  if (group !== undefined) return sequences[group - 1];
  // P000 is reserved for technical rehearsals and uses the first frozen
  // sequence. Formal participant IDs start at P001.
  if (participantNumber === 0) return sequences[0];
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
  if (options['model-calls'] || options['model-tokens']) {
    throw new Error('Study 2 no longer limits model calls or model tokens; remove --model-calls and --model-tokens.');
  }
  if (fs.existsSync(profilePath)) {
    const profile = readJson(profilePath);
    const provided = {
      provider: options.provider,
      modelId: options.model,
      timeLimitSeconds: options['time-limit'] ? positiveInteger(options['time-limit'], 'time limit') : undefined,
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

function findRunForParticipantPeriod(runsRoot, participantId, periodText) {
  participantNumber(participantId);
  const period = Number.parseInt(periodText, 10);
  if (![1, 2].includes(period)) throw new Error('Period must be 1 or 2.');

  const candidates = fs.readdirSync(runsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(session => {
      const sessionRoot = path.join(runsRoot, session.name);
      return fs.readdirSync(sessionRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(sessionRoot, entry.name));
    })
    .filter(runDir => {
      const runPath = path.join(runDir, 'run.json');
      if (!fs.existsSync(runPath)) return false;
      const run = readJson(runPath);
      return run.participantId === participantId && run.period === period;
    });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`More than one prepared run matches ${participantId} period ${period}; specify the full runId.`);
  }
  throw new Error(`Prepared run not found for ${participantId} period ${period}.`);
}

function prepare(participantId, periodText, options) {
  const number = participantNumber(participantId);
  const period = Number.parseInt(periodText, 10);
  if (![1, 2].includes(period)) throw new Error('Period must be 1 or 2.');
  const selected = selectedTaskSet(options);
  const group = groupNumber(options.group, selected);
  const sequence = assignmentFor(number, selected, group);
  const assignment = sequence[`period${period}`];
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const runsRoot = path.resolve(options.runs ?? defaultRunsRoot);
  const participantBundle = path.join(bundlesRoot, assignment.taskId, 'participant');
  if (!fs.existsSync(participantBundle)) {
    throw new Error(`Task bundle missing: ${participantBundle}. Run npm run study:build-tasks first.`);
  }
  const profile = studyProfile(runsRoot, options);
  const runtimePython = venvPython(runtimeRoot);
  if (!fs.existsSync(runtimePython)) {
    throw new Error(`Study Python runtime is missing (${runtimePython}). Run npm run study:setup-runtime first.`);
  }
  const manifestPath = path.join(manifestsDir, `${assignment.taskId}.json`);
  const manifest = readJson(manifestPath);
  const formId = selected.testFormIds[crypto.randomInt(selected.testFormIds.length)];
  const ticket = { ...manifest.ticket };
  if (ticket.mainTicketFile) {
    ticket.mainMarkdown = fs.readFileSync(path.join(studyRoot, ticket.mainTicketFile), 'utf8');
  }
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
    taskSetId: selected.taskSetId,
    group: group ?? null,
    sequenceId: sequence.id,
    period,
    taskId: assignment.taskId,
    formId,
    condition: assignment.condition,
    createdAt: new Date().toISOString(),
    startedAt: null,
    exportDirectory: path.join(sessionRoot, 'participant-exports'),
    timeLimitSeconds: profile.timeLimitSeconds,
    model: {
      provider: profile.provider,
      id: profile.modelId,
    },
    // The prepared run is portable across the participant workspace location:
    // the runtime path is generated on the current machine rather than guessed
    // from /tmp or hard-coded to an operator's home directory.
    runtimePython: path.resolve(runtimePython),
    manifest: {
      taskId: manifest.taskId,
      sha256: sha256File(manifestPath),
      ticket,
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
    // Preserve VS Code's standard layout: Activity Bar and Explorer on the
    // left, ContextBranch in the right Secondary Side Bar. On activation, the
    // extension focuses ContextBranch rather than VS Code's built-in Chat.
    'workbench.sideBar.location': 'left',
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
    'python.defaultInterpreterPath': path.resolve(runtimePython),
    'terminal.integrated.env.osx': { PATH: `${path.dirname(runtimePython)}:\${env:PATH}` },
    'terminal.integrated.env.linux': { PATH: `${path.dirname(runtimePython)}:\${env:PATH}` },
    'terminal.integrated.env.windows': { PATH: `${path.dirname(runtimePython)};\${env:PATH}` },
  };
  writeJson(path.join(vscodeDir, 'settings.json'), settings);
  writeJson(path.join(runDir, 'run.json'), run);
  const result = { runId, sessionRoot, workspace, taskSetId: selected.taskSetId, group: group ?? null, period, taskId: assignment.taskId, formId, condition: assignment.condition, profile };
  if (!options.quiet) console.log(JSON.stringify(result, null, 2));
  return result;
}

function ensureLaunchReady(options) {
  const selected = selectedTaskSet(options);
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const bundlesReady = selected.taskIds.every(taskId => fs.existsSync(path.join(bundlesRoot, taskId, 'participant', '.study', 'task.json')));
  if (!bundlesReady) buildTasks(options);
  if (!fs.existsSync(venvPython(runtimeRoot))) setupRuntime();
  preflight(options);
}

function nasaTlxUrl(run) {
  const base = process.env.WEIGHTED_NASA_TLX_URL ?? 'https://li-ziyou.github.io/weighted-nasa-tlx/';
  const url = new URL(base);
  url.searchParams.set('participant', run.participantId);
  url.searchParams.set('label', `Period ${run.period}: ${run.taskId} (${run.condition})`);
  return url.toString();
}

function openWorkspace(workspace) {
  const code = process.env.VSCODE_CLI ?? (
    isWindows
      ? 'code'
      : process.platform === 'darwin'
        ? '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
        : 'code'
  );
  // VS Code's Windows CLI is a .cmd shim, which needs the Windows command shell.
  execFileSync(code, ['--new-window', workspace], { stdio: 'ignore', shell: isWindows });
}

function openExternal(url) {
  if (isWindows) {
    execFileSync('rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    execFileSync('open', [url], { stdio: 'ignore' });
  } else {
    execFileSync('xdg-open', [url], { stdio: 'ignore' });
  }
}

function launch(participantId, groupText, options) {
  participantNumber(participantId);
  const selected = selectedTaskSet(options);
  const group = groupNumber(groupText, selected);
  if (group === undefined) throw new Error('Provide a group: G1, G2, G3, or G4.');
  ensureLaunchReady(options);
  const runsRoot = path.resolve(options.runs ?? defaultRunsRoot);
  // A new research machine gets the frozen Study 2 default profile. An
  // existing runs root remains authoritative and is never silently changed.
  const profileOptions = fs.existsSync(path.join(runsRoot, 'study-profile.json')) ? {} : {
    provider: process.env.CONTEXTBRANCH_STUDY_PROVIDER ?? 'openrouter',
    model: process.env.CONTEXTBRANCH_STUDY_MODEL ?? 'google/gemini-2.5-flash-lite',
    'time-limit': process.env.CONTEXTBRANCH_STUDY_TIME_LIMIT ?? '1300',
  };
  const launchOptions = { ...options, ...profileOptions, group: String(group), quiet: true };
  const period1 = prepare(participantId, '1', launchOptions);
  const period2 = prepare(participantId, '2', launchOptions);
  // Open in protocol order. The tab label inside each questionnaire identifies
  // the matching period, task, and condition without changing the participant ID.
  openWorkspace(period1.workspace);
  openWorkspace(period2.workspace);
  openExternal(nasaTlxUrl({ ...period1, participantId }));
  openExternal(nasaTlxUrl({ ...period2, participantId }));
  console.log(JSON.stringify({
    participantId,
    group: `G${group}`,
    sequenceId: assignmentFor(participantNumber(participantId), selected, group).id,
    period1: { ...period1, nasaTlxUrl: nasaTlxUrl({ ...period1, participantId }) },
    period2: { ...period2, nasaTlxUrl: nasaTlxUrl({ ...period2, participantId }) },
  }, null, 2));
}

function collect(runReference, periodText, options) {
  const runsRoot = path.resolve(options.runs ?? defaultRunsRoot);
  const runDir = periodText === undefined
    ? findRunDirectory(runsRoot, runReference)
    : findRunForParticipantPeriod(runsRoot, runReference, periodText);
  const runId = readJson(path.join(runDir, 'run.json')).runId;
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
  const selected = selectedTaskSet(options);
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const failures = [];
  for (const manifestFile of manifestFiles(selected)) {
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
  const python = venvPython(runtimeRoot);
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
  console.log(`Study preflight passed for task set ${selected.taskSetId}.`);
}

function setupRuntime() {
  const requirements = path.join(studyRoot, 'runner', 'requirements.txt');
  const python = venvPython(runtimeRoot);
  if (!fs.existsSync(python)) {
    createVenv(runtimeRoot);
  }
  execFileSync(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], { stdio: 'inherit' });
  execFileSync(python, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
  console.log(`Study Python runtime ready: ${python}`);
}

function dryRun(options) {
  preflight(options);
  const selected = selectedTaskSet(options);
  const bundlesRoot = path.resolve(options.bundles ?? defaultBundlesRoot);
  const runtimePython = venvPython(runtimeRoot);
  for (const manifestFile of manifestFiles(selected)) {
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
      execFileSync(runtimePython, [path.join('.study', 'bin', 'study_runner.py'), 'public', '--workspace', '.'], {
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

function buildTasks(options) {
  const selected = selectedTaskSet(options);
  const requirements = path.join(studyRoot, 'task-builder', 'requirements.txt');
  const builder = path.join(studyRoot, 'task-builder', 'build_task.py');
  const builderPython = venvPython(builderRoot);
  if (!fs.existsSync(builderPython)) {
    createVenv(builderRoot);
  }
  execFileSync(builderPython, ['-m', 'pip', 'install', '-r', requirements], { stdio: 'inherit' });
  execFileSync(builderPython, [builder, '--tasks', ...selected.taskIds], { cwd: repoRoot, stdio: 'inherit' });
  console.log(`Study task bundles ready for ${selected.taskSetId}: ${defaultBundlesRoot}`);
}

const [commandName, ...rest] = process.argv.slice(2);
const { positional, options } = parseOptions(rest);
if (commandName === 'validate') validate(options);
else if (commandName === 'assign') assign(positional[0], options);
else if (commandName === 'prepare') prepare(positional[0], positional[1], options);
else if (commandName === 'collect') collect(positional[0], positional[1], options);
else if (commandName === 'preflight') preflight(options);
else if (commandName === 'setup-runtime') setupRuntime();
else if (commandName === 'build-tasks') buildTasks(options);
else if (commandName === 'dry-run') dryRun(options);
else if (commandName === 'launch') launch(positional[0], positional[1], options);
else {
  console.error('Usage: studyctl.mjs validate | assign P017 [--group G1] | prepare P017 1 [--group G1] | launch P017 G1 | collect P017 1 | collect RUN_ID | preflight | setup-runtime | build-tasks | dry-run [--task-set study2-v2|legacy]');
  process.exitCode = 1;
}
