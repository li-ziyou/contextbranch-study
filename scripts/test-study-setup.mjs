import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'study setup 研究-'));
try {
  require('./build-study-assets.cjs').buildStudyAssets(repo);
  const entry = path.join(temporary, 'setup.cjs');
  await require('esbuild').build({
    stdin: { contents: `export * from './src/study/setup'; export * from './src/study/questionnaire';`, resolveDir: repo },
    bundle: true, platform: 'node', format: 'cjs', outfile: entry,
    plugins: [{ name: 'native-setup-boundaries', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'test' }));
      build.onResolve({ filter: /^\.\/runtime$/ }, () => ({ path: 'runtime', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'vscode'
        ? 'module.exports = globalThis.__studySetupHost;'
        : 'exports.ensureStudyRuntime = async () => process.execPath; exports.STUDY_PYTHON_VERSION = "3.14.0"; exports.STUDY_PYTEST_VERSION = "9.2.0";' }));
    } }],
  });
  const opened = [], notifications = [], inputs = [], state = new Map();
  let selectedGroup = 'G1', cancelled = false, savedKey = null;
  const uri = file => ({ fsPath: file });
  globalThis.__studySetupHost = {
    Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    ProgressLocation: { Notification: 15 },
    window: {
      showInputBox: async options => { inputs.push(options); return cancelled ? undefined : options.password ? 'TEST_ONLY_KEY' : 'P000'; },
      showQuickPick: async () => selectedGroup,
      showOpenDialog: async () => [uri(temporary)],
      withProgress: async (_, work) => work({ report() {} }),
      // An undismissed ready notification must never hold up either task window.
      showInformationMessage: message => { notifications.push(message); return new Promise(() => {}); },
    },
    commands: { executeCommand: async (command, target, options) => { opened.push({ command, target, options }); } },
  };
  const { setUpStudy, openStudyTaskWindows, nasaTlxUrl } = require(entry);
  const context = { extensionPath: repo, globalStorageUri: uri(path.join(temporary, 'storage')), globalState: { update: async (key, value) => { state.set(key, value); } } };
  const options = { hasKey: async () => false, saveKey: async key => { savedKey = key; } };
  for (const group of ['G1', 'G2', 'G3', 'G4']) {
    selectedGroup = group; opened.length = 0;
    let timer;
    try {
      await Promise.race([setUpStudy(context, options), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Setup waited for a notification to close')), 5000); })]);
    } finally { clearTimeout(timer); }
    assert.equal(opened.length, 2, 'setup must open both windows');
    const runs = opened.map(item => {
      assert.equal(item.command, 'vscode.openFolder');
      assert.equal(item.options.forceNewWindow, true);
      const root = item.target.fsPath;
      const run = JSON.parse(fs.readFileSync(path.join(root, '.study/run.json')));
      const settings = JSON.parse(fs.readFileSync(path.join(root, '.vscode/settings.json')));
      assert.ok(settings['window.title'].startsWith(`P000 · Task ${run.period} of 2 · `));
      assert.ok(!fs.existsSync(path.join(root, '.study/finished.json')));
      assert.equal(run.startedAt, null);
      const url = new URL(nasaTlxUrl(run));
      assert.equal(url.origin + url.pathname, 'https://li-ziyou.github.io/weighted-nasa-tlx/');
      assert.equal(url.searchParams.get('participant'), 'P000');
      assert.equal(url.searchParams.get('label'), `Period ${run.period}: ${run.taskId} (${run.condition === 'linear' ? 'Linear' : 'GitChat'})`);
      assert.deepEqual([...url.searchParams.keys()], ['participant', 'label'], 'no key or local paths may enter the URL');
      return run;
    });
    assert.deepEqual(runs.map(run => run.period), [2, 1], 'Task 1 should open last and be in front');
    assert.equal(JSON.parse(fs.readFileSync(path.join(state.get('contextbranch.lastStudySession'), 'session.json'))).group, group);
  }
  assert.equal(savedKey, 'TEST_ONLY_KEY');
  assert.ok(inputs.filter(item => item.password).every(item => item.ignoreFocusOut));
  assert.equal(notifications.length, 4);
  // Cancellation must not open windows or replace the last prepared session.
  const previous = state.get('contextbranch.lastStudySession');
  cancelled = true; opened.length = 0;
  await setUpStudy(context, options);
  assert.equal(opened.length, 0); assert.equal(state.get('contextbranch.lastStudySession'), previous);
  // Validate both task roots before opening either one.
  const session = JSON.parse(fs.readFileSync(path.join(previous, 'session.json')));
  fs.unlinkSync(path.join(previous, session.periods[0].workspace, '.study/run.json'));
  await assert.rejects(openStudyTaskWindows(previous), /workspace was not found/);
  assert.equal(opened.length, 0);
  console.log('Study setup passed: all groups open both labeled windows, Task 1 in front, no timer starts or notification waits; per-task NASA-TLX prefills; cancellation and missing-workspace handling.');
} finally {
  delete globalThis.__studySetupHost;
  fs.rmSync(temporary, { recursive: true, force: true });
}
