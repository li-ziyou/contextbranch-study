#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const studyRoot = path.resolve(here, '..');
const manifestsDir = path.join(studyRoot, 'manifests');
const sequencesPath = path.join(here, 'assignment-sequences.json');
const requiredManifestFields = [
  'schemaVersion', 'taskId', 'participantTitle', 'featureBench', 'source',
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
    if (!Array.isArray(manifest.submission?.allowedProductionPaths) || manifest.submission.allowedProductionPaths.length === 0) {
      failures.push(`${path.basename(file)}: requires an allowlisted production path`);
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
  const sequences = readJson(sequencesPath).sequences;
  const sequence = sequences[(participantNumber - 1) % sequences.length];
  console.log(JSON.stringify({ participantId, sequence }, null, 2));
}

const [command, argument] = process.argv.slice(2);
if (command === 'validate') validate();
else if (command === 'assign') assign(argument);
else {
  console.error('Usage: studyctl.mjs validate | assign P017');
  process.exitCode = 1;
}
