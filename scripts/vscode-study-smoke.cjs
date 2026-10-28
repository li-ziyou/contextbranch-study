const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
exports.run = async function() {
  const vscode = require('vscode');
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gitchat-vsix-smoke-'));
  const extension = vscode.extensions.getExtension('contextbranch.contextbranch');
  assert.ok(extension, 'the installed study VSIX must be discoverable');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['contextbranch.setupStudy', 'contextbranch.exportResearchPackage', 'contextbranch.openOtherStudyTask']) assert.ok(commands.includes(id), id);
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const run = JSON.parse(fs.readFileSync(path.join(root, '.study/run.json')));
  assert.equal(run.timeLimitSeconds, 1200);
  assert.equal(run.startedAt, null);
  const document = await vscode.workspace.openTextDocument(path.join(root, run.manifest.submission.allowedProductionPaths[0]));
  const edit = new vscode.WorkspaceEdit(); edit.insert(document.uri, new vscode.Position(0, 0), '# UNSAVED_UI_EXPORT_CHECK\n');
  await vscode.workspace.applyEdit(edit); assert.equal(document.isDirty, true);
  const save = vscode.window.showSaveDialog, info = vscode.window.showInformationMessage, error = vscode.window.showErrorMessage;
  vscode.window.showErrorMessage = async message => { fs.writeFileSync(path.join(outputDirectory, 'export-error.txt'), String(message)); return undefined; };
  const output = path.join(outputDirectory, 'without-finish.zip');
  const fakeSave = async () => { fs.writeFileSync(path.join(outputDirectory, 'dialog-called.txt'),'yes'); return vscode.Uri.file(output); };
  vscode.window.showSaveDialog = fakeSave;
  vscode.window.showInformationMessage = async () => undefined;
  assert.equal(vscode.window.showSaveDialog, fakeSave, 'VS Code dialog seam must be available for this integration test');
  try {
    await Promise.race([vscode.commands.executeCommand('contextbranch.exportResearchPackage'), new Promise((_, reject) => setTimeout(()=>reject(new Error('UI export command timed out')), 20_000))]);
    assert.ok(fs.existsSync(output));
    assert.equal(document.isDirty, true, 'export must not save unsaved editor text');
    assert.ok(!fs.existsSync(path.join(root, '.study/finished.json')), 'export must not finish the task');
    const recovery = JSON.parse(fs.readFileSync(path.join(root, '.study/live-state.json')));
    assert.ok(recovery.unsavedEditors.some(item => item.content.includes('UNSAVED_UI_EXPORT_CHECK')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.study/run.json'))).startedAt, null);
    fs.writeFileSync(path.join(outputDirectory, 'result.json'),JSON.stringify({passed:true,package:extension.packageJSON.version,root,zip:output,registeredCommands:true,unfinishedExport:true,unsavedBufferPreserved:true},null,2));
    console.log('Installed VSIX integration test passed: command registration, unfinished two-period export, unsaved buffer preserved, no fake Finish.');
  } finally { vscode.window.showSaveDialog=save;vscode.window.showInformationMessage=info;vscode.window.showErrorMessage=error; }
};
