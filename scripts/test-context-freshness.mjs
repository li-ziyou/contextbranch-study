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
  const {
    EDIT_PROPOSAL_CONTEXT,
    buildArtifactContext,
    buildCodingHistoryMessages,
  } = await import(pathToFileURL(bundle));
  const context = buildArtifactContext(
    [{ path: 'navigation.py', content: 'return STALE_ARTIFACT' }],
    [{ path: 'navigation.py', size: 20, symbols: [] }],
    [{ path: 'navigation.py', content: 'return FRESH_DISK_EDIT' }],
  );

  assert.match(context, /FRESH_DISK_EDIT/);
  assert.doesNotMatch(context, /STALE_ARTIFACT/);

  const editBlock = '<<<<<<< SEARCH\n'.padEnd(12_000, 'x') + '\n=======\nnew\n>>>>>>> REPLACE';
  const history = [
    { id: 'old', role: 'user', content: 'old request '.repeat(100), timestamp: 1 },
    { id: 'edit', role: 'assistant', content: editBlock, timestamp: 2, meta: { artifactIds: ['groups.py'] } },
    { id: 'test', role: 'user', content: 'F'.repeat(8_000), timestamp: 3 },
    { id: 'latest', role: 'user', content: 'fix the missing message evidence', timestamp: 4 },
  ];
  const messages = buildCodingHistoryMessages(history);
  assert.deepEqual(
    messages.map(message => message.content),
    ['old request '.repeat(100), EDIT_PROPOSAL_CONTEXT, 'F'.repeat(8_000), 'fix the missing message evidence'],
    'completed edit blocks must not be replayed, but ordinary history must be retained',
  );
  assert.doesNotMatch(messages.join('\n'), /<<<<<<< SEARCH/);

  const manySmallTurns = Array.from({ length: 40 }, (_, index) => ({
    id: `turn-${index}`,
    role: 'user',
    content: `turn ${index}`,
    timestamp: index,
  }));
  assert.equal(
    buildCodingHistoryMessages(manySmallTurns).length,
    40,
    'the history budget must not impose a separate message-count limit',
  );
  console.log('Context freshness tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
