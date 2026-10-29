import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitchat-study-branches-'));
try {
  const entry = path.join(temporary, 'checks.cjs');
  await esbuild.build({
    stdin: { contents: `export { StudyController } from './src/study/controller'; export { Workspace } from './src/core/workspace'; export { Storage } from './src/core/storage'; export { ContextBranchView } from './src/webview/webview-manager'; export { previewMerge, finalizeMerge } from './src/core/merge';`, resolveDir: process.cwd() },
    bundle: true, platform: 'node', format: 'cjs', outfile: entry, logLevel: 'silent',
    plugins: [{ name: 'vscode-test-host', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'module.exports = globalThis.__branchTestHost;' }));
    } }],
  });
  globalThis.__branchTestHost = { workspace: { workspaceFolders: [], getConfiguration: () => ({ get: () => true }) } };
  const { StudyController, Workspace, Storage, ContextBranchView, previewMerge, finalizeMerge } = require(entry);
  const manifest = {
    ticket: { summary: 'Example task', requirements: [] }, sha256: 'test',
    contextBranch: { siblingStates: [{ id: 'A', label: 'A', ticket: { requirements: [] } }, { id: 'B', label: 'B', ticket: { requirements: [] } }], finalVerification: 'Test Main' },
    runner: { publicTestCommand: 'main', publicTestCommands: { responsibilityA: 'test-a', responsibilityB: 'test-b', main: 'test-all' } },
    submission: { finalState: 'main', allowedProductionPaths: ['example.py'] },
  };
  function task(name, condition = 'contextbranch', startedAt = null) {
    const root = path.join(temporary, name);
    fs.mkdirSync(path.join(root, '.study'), { recursive: true });
    const run = { schemaVersion: 1, runId: name, participantId: 'P000', period: 1, taskId: 'example', condition, startedAt, timeLimitSeconds: 1200, manifest };
    fs.writeFileSync(path.join(root, '.study/run.json'), JSON.stringify(run));
    fs.writeFileSync(path.join(root, 'example.py'), 'value = 0\n');
    const ws = new Workspace(new Storage(path.join(root, '.contextbranch')));
    ws.upsertArtifact(ws.mainBranchId, 'example.py', 'value = 0\n');
    const study = StudyController.load(root);
    study.initialize(ws);
    return { root, ws, study };
  }
  const { ws, study, root } = task('branches');
  assert.throws(() => study.createParticipantBranch(ws, 'before-start'), /Start task/);
  study.start(ws);
  assert.throws(() => study.createParticipantBranch(ws, '  '), /name is required/);
  const siblingA = ws.getAllBranches().find(branch => branch.tags?.includes('A'));
  ws.switchBranch(siblingA.id);
  ws.appendMessage(siblingA.id, 'user', 'Try another implementation');
  ws.upsertArtifact(siblingA.id, 'example.py', 'value = 1\n');
  const branchId = study.createParticipantBranch(ws, 'Alternative', 'Try another approach');
  assert.equal(ws.getBranch(branchId).parentBranchId, siblingA.id);
  assert.deepEqual(ws.getMessages(branchId), ws.getMessages(siblingA.id));
  assert.equal(ws.getArtifacts(branchId)[0].content, 'value = 1\n');
  ws.switchBranch(branchId);
  assert.equal(study.publicTestSelection(ws).command, 'test-a');
  assert.ok(study.uiState(ws).integratableStateIds.includes(branchId));
  assert.equal(study.uiState(ws).siblingStateIds.length, 2);
  assert.equal(study.allowsMerge(branchId, ws.mainBranchId, ws), true);
  assert.equal(study.allowsMerge(branchId, siblingA.id, ws), true);
  assert.equal(study.allowsMerge(branchId, branchId, ws), false);
  assert.equal(study.allowsMerge(branchId, 'missing', ws), false);
  assert.equal(study.allowsMerge(ws.mainBranchId, branchId, ws), false, 'main stays the submission root');
  const nested = study.createParticipantBranch(ws, 'Nested alternative');
  ws.switchBranch(nested);
  assert.equal(study.publicTestSelection(ws).command, 'test-a');
  ws.upsertArtifact(nested, 'example.py', 'value = 2\n');
  assert.equal(ws.getArtifacts(siblingA.id)[0].content, 'value = 1\n', 'child edits must stay isolated');
  const preview = await previewMerge(ws, { sourceBranchId: nested, targetBranchId: ws.mainBranchId, skipVerification: true, generateSynthesis: false });
  const mergeOptions = { sourceBranchId: nested, targetBranchId: ws.mainBranchId, skipVerification: true, generateSynthesis: false };
  await assert.rejects(finalizeMerge(ws, mergeOptions, preview), /unresolved file conflict/);
  await finalizeMerge(ws, { ...mergeOptions, acceptedConflictPaths: ['example.py'], manualResolvedContents: { 'example.py': 'value = 2\n' } }, preview);
  assert.equal(ws.getArtifacts(ws.mainBranchId)[0].content, 'value = 2\n');
  assert.equal(study.allowsMerge(nested, ws.mainBranchId, ws), false, 'merged branches cannot integrate again');
  ws.switchBranch(ws.mainBranchId);
  const general = study.createParticipantBranch(ws, 'General');
  ws.switchBranch(general);
  assert.equal(study.publicTestSelection(ws).command, 'test-all');
  const siblingB = ws.getAllBranches().find(branch => branch.tags?.includes('B'));
  ws.switchBranch(siblingB.id);
  const bChild = study.createParticipantBranch(ws, 'B alternative');
  ws.switchBranch(bChild);
  assert.equal(study.publicTestSelection(ws).command, 'test-b');
  assert.throws(() => ws.upsertArtifact(bChild, 'tests/test_example.py', 'changed'), /protect|test/i);
  const events = ws.storage.loadTelemetry().filter(event => event.type === 'study_state_created' && event.actor === 'participant');
  assert.equal(events.length, 4);
  assert.ok(events.every(event => event.runId === 'branches' && event.parentStateId && event.checkpointId));

  // Exercise the actual message handler, including its normal switch path.
  const view = Object.create(ContextBranchView.prototype);
  const errors = [], outgoing = [];
  Object.assign(view, {
    getStudyController: () => study, getWorkspace: () => ws,
    codingRuns: new Map(), pendingEditsByBranch: new Map(),
    postMessage: message => { outgoing.push(message); if (message.type === 'error') errors.push(message.message); },
    getCapture: () => null,
    getDecorations: () => ({ dismissAllPreviews: async () => {}, snapshotBefore() {}, noteSelfWrite() {}, markChanges() {} }), pushState: () => {},
  });
  const before = ws.getAllBranches().length;
  view.codingRuns.set(bChild, {});
  await view.handleMessage({ type: 'createBranch', name: 'Busy' });
  assert.equal(ws.getAllBranches().length, before);
  view.codingRuns.clear();
  view.pendingEditsByBranch.set(bChild, {});
  await view.handleMessage({ type: 'createBranch', name: 'Pending' });
  assert.equal(ws.getAllBranches().length, before);
  view.pendingEditsByBranch.clear();
  view.studyTestRunningStateId = bChild;
  await view.handleMessage({ type: 'createBranch', name: 'Testing' });
  assert.equal(ws.getAllBranches().length, before);
  view.studyTestRunningStateId = undefined;
  await view.handleMessage({ type: 'createBranch', name: 'From old message', fromMessageId: 'old' });
  assert.equal(ws.getAllBranches().length, before);
  globalThis.__branchTestHost.workspace.workspaceFolders = [{ uri: { fsPath: root } }];
  fs.writeFileSync(path.join(root, 'example.py'), 'value = 3\n');
  await view.handleMessage({ type: 'createBranch', name: 'Created through UI' });
  assert.equal(ws.getAllBranches().length, before + 1);
  assert.equal(ws.getActiveBranch().name, 'Created through UI');
  assert.equal(ws.getArtifacts(ws.activeBranchId)[0].content, 'value = 3\n', 'fork must include a save before the watcher fires');
  assert.equal(fs.readFileSync(path.join(root, 'example.py'), 'utf8'), 'value = 3\n', 'switching to the fork must preserve the saved edit');
  await view.handleMessage({ type: 'openStudyIntegration' });
  assert.equal(outgoing.at(-1).type, 'openStudyIntegration');
  assert.equal(outgoing.at(-1).sourceBranchId, ws.activeBranchId);
  assert.ok(ws.storage.loadTelemetry().some(event => event.type === 'study_state_switched' && event.reason === 'branch_created'));
  assert.equal(errors.length, 4);

  // Preview and finalize through the real handler into a sibling, then main.
  const cross = task('branch-merges');
  cross.study.start(cross.ws);
  const targetA = cross.ws.getAllBranches().find(branch => branch.tags?.includes('A'));
  const sourceB = cross.ws.getAllBranches().find(branch => branch.tags?.includes('B'));
  cross.ws.switchBranch(sourceB.id);
  const custom = cross.study.createParticipantBranch(cross.ws, 'Custom source');
  cross.ws.switchBranch(custom);
  cross.ws.upsertArtifact(custom, 'example.py', 'value = 1\n');
  const mergeMessages = [];
  const merger = Object.create(ContextBranchView.prototype);
  Object.assign(merger, {
    getStudyController: () => cross.study, getWorkspace: () => cross.ws, getProvider: () => null,
    codingRuns: new Map(), pendingEditsByBranch: new Map(),
    getCapture: () => null, getDecorations: view.getDecorations, pushState: () => {},
    postMessage: message => mergeMessages.push(message),
  });
  globalThis.__branchTestHost.workspace.workspaceFolders = [{ uri: { fsPath: cross.root } }];
  for (const [sourceBranchId, targetBranchId] of [[custom, targetA.id], [targetA.id, cross.ws.mainBranchId]]) {
    await merger.handleMessage({ type: 'previewMerge', sourceBranchId, targetBranchId });
    assert.equal(mergeMessages.at(-1).type, 'mergePreview');
    const wrongTarget = targetBranchId === targetA.id ? cross.ws.mainBranchId : sourceB.id;
    await merger.handleMessage({ type: 'mergeBranch', sourceBranchId, targetBranchId: wrongTarget, force: false });
    assert.match(mergeMessages.at(-1).message, /Preview this exact merge/);
    await merger.handleMessage({ type: 'mergeBranch', sourceBranchId, targetBranchId, force: false });
    assert.equal(mergeMessages.at(-1).type, 'mergeCompleted');
    assert.equal(cross.ws.activeBranchId, targetBranchId);
    assert.equal(cross.ws.getArtifacts(targetBranchId)[0].content, 'value = 1\n');
    if (targetBranchId === targetA.id) {
      assert.equal(cross.ws.getArtifacts(cross.ws.mainBranchId)[0].content, 'value = 0\n');
      assert.equal(cross.study.publicTestSelection(cross.ws).command, 'test-a');
    }
  }
  const integrationEvents = cross.ws.storage.loadTelemetry().filter(event => event.type === 'study_integration_completed');
  assert.deepEqual(integrationEvents.map(event => event.targetStateId), [targetA.id, cross.ws.mainBranchId]);
  assert.deepEqual(cross.ws.storage.loadTelemetry().filter(event => event.type === 'study_integration_opened').map(event => event.targetStateId), [targetA.id, cross.ws.mainBranchId]);
  assert.equal(cross.study.allowsMerge(sourceB.id, targetA.id, cross.ws), false, 'merged targets are unavailable');
  cross.ws.setBranchStatus(sourceB.id, 'abandoned');
  assert.equal(cross.study.allowsMerge(custom, sourceB.id, cross.ws), false);

  const linear = task('linear', 'linear');
  linear.study.start(linear.ws);
  assert.throws(() => linear.study.createParticipantBranch(linear.ws, 'No'), /Linear/);
  assert.equal(linear.ws.getAllBranches().length, 1);
  const expired = task('expired', 'contextbranch', new Date(Date.now() - 1_300_000).toISOString());
  assert.throws(() => expired.study.createParticipantBranch(expired.ws, 'No'), /time limit/);
  fs.writeFileSync(path.join(root, '.study/finished.json'), '{}');
  assert.throws(() => study.createParticipantBranch(ws, 'after-finish'), /finished/);

  // Run the shipped webview client against a small DOM host and click its controls.
  const elements = new Map(), windowListeners = new Map(), sent = [];
  function element() {
    return {
      hidden: false, disabled: false, value: '', textContent: '', children: [], listeners: {}, dataset: {},
      get innerHTML() { return this._html || ''; },
      set innerHTML(value) { this._html = value; this.children = []; this.value = ''; },
      get options() { return this.children; },
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      parentElement: { style: {} }, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
      addEventListener(type, listener) { this.listeners[type] = listener; },
      appendChild(child) { this.children.push(child); if (child.selected || !this.value) this.value = child.value || ''; return child; },
      querySelectorAll() { return []; }, querySelector() { return null; }, focus() {}, remove() {},
      setAttribute() {}, getBoundingClientRect() { return { width: 1000, right: 1000 }; },
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const browser = { addEventListener: (type, listener) => windowListeners.set(type, listener) };
  vm.runInNewContext(fs.readFileSync('webview/app.js', 'utf8'), {
    window: browser, document: { getElementById: get, createElement: element, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, body: element() },
    acquireVsCodeApi: () => ({ postMessage: message => sent.push(message) }), console, setTimeout, clearTimeout,
  });
  const uiStudy = { condition: 'contextbranch', started: false, finished: false, remainingSeconds: 1200, timeLimitSeconds: 1200, integratableStateIds: ['custom'], siblingStateIds: [], participantId: 'P000', period: 1 };
  const update = (patch = {}) => windowListeners.get('message')({ data: { type: 'state', condition: 'contextbranch', providerReady: true, activeBranchId: 'custom', activeBranchName: 'Custom', branches: [{ id: 'custom', name: 'Custom', status: 'active' }], messages: [], study: uiStudy, ...patch } });
  update();
  assert.equal(get('btn-new-branch').hidden, false);
  assert.equal(get('btn-new-branch').disabled, true, 'creation waits for Start');
  uiStudy.started = true;
  update();
  assert.equal(get('btn-new-branch').disabled, false);
  assert.equal(get('study-integrate').hidden, false, 'custom branch exposes reviewed integration');
  get('btn-new-branch').listeners.click();
  assert.equal(get('modal-branch').hidden, false);
  get('branch-name').value = 'UI alternative';
  get('branch-create').listeners.click();
  assert.equal(sent.at(-1).type, 'createBranch');
  assert.equal(sent.at(-1).name, 'UI alternative');
  for (const patch of [{ branchRuns: { custom: {} } }, { pendingEdits: [] }, { studyTestsRunning: true }]) {
    update({ branchRuns: {}, pendingEdits: null, studyTestsRunning: false, ...patch });
    assert.equal(get('btn-new-branch').disabled, true);
  }
  update({ branchRuns: {}, pendingEdits: null, studyTestsRunning: false, mainBranchId: 'main', branches: [
    { id: 'custom', name: 'Custom', status: 'active' }, { id: 'main', name: 'main', status: 'active' },
    { id: 'other', name: 'Other branch', status: 'active' }, { id: 'merged', name: 'Merged', status: 'merged' },
    { id: 'abandoned', name: 'Abandoned', status: 'abandoned' }, { id: 'draft', name: 'Draft', status: 'draft' },
  ] });
  windowListeners.get('message')({ data: { type: 'openStudyIntegration', sourceBranchId: 'custom', targetBranchId: 'main' } });
  assert.equal(get('merge-target-select').disabled, false);
  assert.deepEqual(get('merge-target-select').options.map(option => option.value), ['main', 'other']);
  get('merge-target-select').value = 'other';
  get('merge-target-select').listeners.change();
  get('merge-preview-btn').listeners.click();
  assert.equal(sent.at(-1).targetBranchId, 'other');
  assert.equal(get('merge-target-select').disabled, true, 'target stays fixed during preview generation');
  browser.__cb.state.pendingMerge = { sourceBranchId: 'custom', targetBranchId: 'other' };
  get('merge-target-select').value = 'main';
  get('merge-target-select').listeners.change();
  const beforeConfirm = sent.length;
  get('merge-confirm').listeners.click();
  assert.equal(sent.length, beforeConfirm, 'changing target requires another preview');
  update({ study: { ...uiStudy, finished: true } });
  assert.equal(get('btn-new-branch').disabled, true);
  update({ study: { ...uiStudy, remainingSeconds: 0 } });
  assert.equal(get('btn-new-branch').disabled, true);
  update({ study: { ...uiStudy, condition: 'linear' }, condition: 'linear' });
  assert.equal(get('btn-new-branch').hidden, true);
  update({ study: null });
  assert.equal(get('btn-new-branch').hidden, true, 'regular mode retains its existing branch menu');
  console.log('Study branching passed: handler guards, inherited conversations/code, nested isolation, A/B/Main test routing, reviewed integration, telemetry, Linear, timeout and Finish.');
} finally {
  delete globalThis.__branchTestHost;
  fs.rmSync(temporary, { recursive: true, force: true });
}
