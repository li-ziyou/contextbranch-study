import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-conflict-resolution-'));
const bundle = path.join(tempDir, 'conflict-resolver.mjs');

try {
  await esbuild.build({
    entryPoints: ['src/agents/conflict-resolver.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { extractSingleCompleteFileBlock } = await import(pathToFileURL(bundle));

  const plainFence = [
    'CONFIDENCE: high',
    'RATIONALE: Keep the tested source implementation.',
    '```python',
    'from .model import Node',
    '',
    'def attach(parent: Node, name: str, child: Node) -> None:',
    '    parent._children[name] = child',
    '```',
  ].join('\n');
  assert.equal(
    extractSingleCompleteFileBlock(plainFence),
    'from .model import Node\n\ndef attach(parent: Node, name: str, child: Node) -> None:\n    parent._children[name] = child\n',
    'one complete ordinary code fence should be accepted for the known conflict path',
  );

  const ambiguous = '```python\nfirst = 1\n```\n```python\nsecond = 2\n```';
  assert.equal(
    extractSingleCompleteFileBlock(ambiguous),
    undefined,
    'multiple fences must remain invalid instead of guessing which file is complete',
  );

  assert.equal(
    extractSingleCompleteFileBlock('CONFIDENCE: high\nNo file returned.'),
    undefined,
    'prose without a complete file block must remain invalid',
  );

  console.log('Conflict resolution parser tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
