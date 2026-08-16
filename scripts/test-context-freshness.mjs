import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-context-freshness-'));
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
  const { buildArtifactContext } = await import(pathToFileURL(bundle));
  const context = buildArtifactContext(
    [{ path: 'navigation.py', content: 'return STALE_ARTIFACT' }],
    [{ path: 'navigation.py', size: 20, symbols: [] }],
    [{ path: 'navigation.py', content: 'return FRESH_DISK_EDIT' }],
  );

  assert.match(context, /FRESH_DISK_EDIT/);
  assert.doesNotMatch(context, /STALE_ARTIFACT/);
  console.log('Context freshness tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
