import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-output-limit-'));
const bundle = path.join(tempDir, 'coding.mjs');

try {
  await esbuild.build({
    entryPoints: ['src/agents/coding.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundle,
    logLevel: 'silent',
  });
  const { codingMaxOutputTokens } = await import(pathToFileURL(bundle));

  assert.equal(codingMaxOutputTokens('google/gemini-2.5-flash-lite'), 65_536);
  assert.equal(codingMaxOutputTokens('another/model'), 8_192);
  assert.equal(codingMaxOutputTokens(), 8_192);

  console.log('Coding output limit tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
