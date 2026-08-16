import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-edit-recovery-'));
const bundle = path.join(tempDir, 'edits.mjs');

try {
  await esbuild.build({
    entryPoints: ['src/core/edits.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { applyEdits, buildEditRetryInstruction, parseEdits } = await import(pathToFileURL(bundle));

  const current = [
    'def relative_path(node, target):',
    '    # Current comments added by an earlier accepted edit.',
    '    # The formula itself still needs correction.',
    '    path_up = [".."] * (len(node.ancestors) - node.ancestors.index(lca))',
    '    return path_up',
  ].join('\n');
  const staleDraft = [
    '```css',
    '# path: navigation.py',
    '<<<<<<< SEARCH',
    'def relative_path(node, target):',
    '    path_up = [".."] * (len(node.ancestors) - node.ancestors.index(lca))',
    '    return path_up',
    '=======',
    'def relative_path(node, target):',
    '    path_up = [".."] * (node.ancestors.index(lca) + 1)',
    '    return path_up',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n');
  const staleOps = parseEdits(staleDraft);
  const staleResult = applyEdits(staleOps, new Map([['navigation.py', current]]));
  assert.equal(staleResult[0].failedCount, 1, 'a stale multi-line anchor must be refused');
  assert.equal(staleResult[0].after, current, 'a refused edit must not mutate content');

  const retryInstruction = buildEditRetryInstruction(
    staleResult,
    staleDraft,
    new Map([['navigation.py', current]]),
  );
  assert.match(retryInstruction, /TOOL EDIT RECOVERY/);
  assert.match(retryInstruction, /navigation\.py/);
  assert.match(retryInstruction, /could not locate the SEARCH anchor/);
  assert.match(retryInstruction, /only automatic retry/);
  assert.match(retryInstruction, /AUTHORITATIVE CURRENT FILE CONTENTS/);
  assert.doesNotMatch(retryInstruction, /Failed SEARCH:/);
  assert.doesNotMatch(retryInstruction, /def relative_path\(self, target\):\n        path_up/);
  assert.match(retryInstruction, /Current comments added by an earlier accepted edit/);
  assert.doesNotMatch(retryInstruction, /Previous proposal for intent only/);

  const correctedDraft = [
    '```css',
    '# path: navigation.py',
    '<<<<<<< SEARCH',
    '    path_up = [".."] * (len(node.ancestors) - node.ancestors.index(lca))',
    '=======',
    '    path_up = [".."] * (node.ancestors.index(lca) + 1)',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n');
  const corrected = applyEdits(
    parseEdits(correctedDraft),
    new Map([['navigation.py', current]]),
  );
  assert.equal(corrected[0].failedCount, 0, 'a unique current-file anchor should apply');
  assert.match(corrected[0].after, /node\.ancestors\.index\(lca\) \+ 1/);

  const sequentialDraft = [
    '```txt',
    '# path: values.txt',
    '<<<<<<< SEARCH',
    'a=1',
    '=======',
    'a=3',
    '>>>>>>> REPLACE',
    '<<<<<<< SEARCH',
    'b=2',
    '=======',
    'b=4',
    '>>>>>>> REPLACE',
    '```',
  ].join('\n');
  const sequential = applyEdits(
    parseEdits(sequentialDraft),
    new Map([['values.txt', 'a=1\nb=2']]),
  );
  assert.equal(sequential[0].failedCount, 0, 'multiple independent hunks should apply in order');
  assert.equal(sequential[0].after, 'a=3\nb=4');

  const truncatedDraft = [
    '```css',
    '# path: navigation.py',
    '<<<<<<< SEARCH',
    'old line',
    '=======',
    'new line',
    '```',
  ].join('\n');
  const truncated = applyEdits(
    parseEdits(truncatedDraft),
    new Map([['navigation.py', current]]),
  );
  assert.equal(truncated[0].failedCount, 1, 'a truncated edit must be refused');
  assert.match(truncated[0].ops[0].reason, /malformed or truncated/);

  console.log('Edit recovery tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
