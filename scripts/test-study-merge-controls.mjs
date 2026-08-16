import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('webview/app.js', 'utf8');
const manager = fs.readFileSync('src/webview/webview-manager.ts', 'utf8');
const resolver = fs.readFileSync('src/agents/conflict-resolver.ts', 'utf8');
const studyController = fs.readFileSync('src/study/controller.ts', 'utf8');

const renderConflicts = app.slice(
  app.indexOf('function renderConflictResolutions'),
  app.indexOf('function collectAcceptedConflictResolutions'),
);
assert.match(
  renderConflicts,
  /resolveBtn\.hidden = manual;/,
  'prepared study tasks must expose manual conflict resolution',
);
assert.doesNotMatch(
  renderConflicts,
  /resolveBtn\.hidden = manual \|\| !!state\.study/,
  'study mode must not hide the only safe conflict-resolution action',
);

const beginManual = manager.slice(
  manager.indexOf('private async handleBeginManualMergeResolution'),
  manager.indexOf('private async handleFinalizeManualMergeResolution'),
);
assert.doesNotMatch(
  beginManual,
  /Manual IDE conflict resolution is disabled during prepared study tasks/,
);
assert.match(beginManual, /study\.allowsMerge\(/);

const finalizeManual = manager.slice(
  manager.indexOf('private async handleFinalizeManualMergeResolution'),
  manager.indexOf('private async handleReviseConflictResolution'),
);
assert.match(finalizeManual, /skipVerification: Boolean\(study\)/);
assert.match(finalizeManual, /study\.recordIntegrationCompleted\(/);
assert.match(finalizeManual, /study\.allowsMerge\(/);

const previewMerge = manager.slice(
  manager.indexOf('private async handlePreviewMerge'),
  manager.indexOf('private async handleBeginManualMergeResolution'),
);
assert.match(previewMerge, /const provider = this\.getProvider\(\);/);
assert.match(previewMerge, /Boolean\(study\) \|\| semanticMerge/);
assert.match(previewMerge, /buildResolveConflictHook\(\{ study, sourceBranchId, targetBranchId \}\)/);
assert.match(previewMerge, /const analyzeCascade = !study && semanticMerge/);

assert.match(resolver, /model\?: string;/);
assert.match(resolver, /model: opts\.model/);
assert.match(studyController, /study_merge_model_call_started/);
assert.match(studyController, /study_merge_model_call_completed/);

console.log('Study merge control tests passed.');
