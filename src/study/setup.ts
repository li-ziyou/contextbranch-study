import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ensureStudyRuntime, STUDY_PYTHON_VERSION, STUDY_PYTEST_VERSION } from './runtime';
import { prepareStudySession, StudySession, verifyStudyAssets } from './preparation';

export async function setUpStudy(context: vscode.ExtensionContext, options: {
  hasKey: () => Promise<boolean>; saveKey: (key: string) => Promise<void>;
}): Promise<void> {
  const participantId = await vscode.window.showInputBox({
    title: 'Set up user study', prompt: 'Participant ID', value: 'P000', ignoreFocusOut: true,
    validateInput: value => /^P\d{3,}$/.test(value) ? null : 'Use P000 for a rehearsal, or a participant ID such as P001.',
  });
  if (!participantId) return;
  const group = await vscode.window.showQuickPick(['G1', 'G2', 'G3', 'G4'], { title: 'Set up user study', placeHolder: 'Assigned counterbalancing group', ignoreFocusOut: true });
  if (!group) return;
  if (!await options.hasKey()) {
    const key = await vscode.window.showInputBox({ title: 'Study API key', prompt: 'Researcher OpenRouter API key', password: true, ignoreFocusOut: true, validateInput: value => value.trim() ? null : 'Enter the researcher API key.' });
    if (!key) return;
    await options.saveKey(key.trim());
  }
  const defaultDirectory = vscode.Uri.joinPath(context.globalStorageUri, 'sessions');
  fs.mkdirSync(defaultDirectory.fsPath, { recursive: true });
  const folders = await vscode.window.showOpenDialog({ title: 'Choose where to save study sessions', canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: defaultDirectory, openLabel: 'Save sessions here' });
  if (!folders?.[0]) return;
  const assets = path.join(context.extensionPath, 'study-assets');
  verifyStudyAssets(assets);
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing the user study', cancellable: false }, async progress => {
    const runtimePython = await ensureStudyRuntime(path.join(context.globalStorageUri.fsPath, 'study-runtime-3.14.0'), message => progress.report({ message }));
    progress.report({ message: 'Creating the two task workspaces…' });
    return prepareStudySession({ assets, parent: folders[0].fsPath, participantId, group: group as StudySession['group'], runtimePython, environment: { platform: process.platform, arch: process.arch, node: process.versions.node, python: STUDY_PYTHON_VERSION, pytest: STUDY_PYTEST_VERSION } });
  });
  await context.globalState.update('contextbranch.lastStudySession', result.directory);
  await openStudyTaskWindows(result.directory);
  void vscode.window.showInformationMessage(`${participantId} · ${group}: both task windows are ready. Complete Task 1 before Task 2. Each timer starts when Start task is pressed.`);
}
export async function openStudyTaskWindows(sessionDirectory: string): Promise<void> {
  const session = JSON.parse(fs.readFileSync(path.join(sessionDirectory, 'session.json'), 'utf8')) as StudySession;
  const roots = [...session.periods].sort((a, b) => b.period - a.period)
    .map(period => path.join(sessionDirectory, period.workspace));
  for (const root of roots) {
    if (!fs.existsSync(path.join(root, '.study/run.json'))) throw new Error('A prepared task workspace was not found.');
  }
  // Open Task 1 last so it is in front, with Task 2 already available in its own window.
  for (const root of roots) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(root), { forceNewWindow: true });
  }
}
