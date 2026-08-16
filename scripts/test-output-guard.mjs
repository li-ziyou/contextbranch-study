import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-output-guard-'));
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
    buildCodingHistoryMessages,
    buildEditRecoveryHistoryMessages,
    hasRepeatedSearchReplaceBlock,
    INTERRUPTED_ASSISTANT_CONTEXT,
  } = await import(pathToFileURL(bundle));

  const history = [
    { id: '1', role: 'assistant', content: 'repeated broken draft '.repeat(500), timestamp: 1,
      meta: { interrupted: true, interruptionReason: 'output_limit' } },
    { id: '2', role: 'user', content: 'Continue with a narrower fix.', timestamp: 2 },
    { id: '3', role: 'assistant', content: 'A valid completed answer.', timestamp: 3 },
  ];
  const messages = buildCodingHistoryMessages(history, 32);
  assert.equal(messages[0].content, INTERRUPTED_ASSISTANT_CONTEXT);
  assert.equal(messages[1].content, 'Continue with a narrower fix.');
  assert.equal(messages[2].content, 'A valid completed answer.');
  assert.ok(!messages.some(message => message.content.includes('repeated broken draft')));

  const repairHistory = buildEditRecoveryHistoryMessages([
    { id: 'u1', role: 'user', content: 'Implement navigation.', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '<<<<<<< SEARCH\nstale anchor\n=======', timestamp: 2 },
    { id: 's1', role: 'system', content: '[study] Task requirements', timestamp: 3 },
    { id: 'u2', role: 'user', content: 'Fix the failed tests.', timestamp: 4 },
  ]);
  assert.ok(repairHistory.some(message => message.content === 'Implement navigation.'));
  assert.ok(repairHistory.some(message => message.content === 'Fix the failed tests.'));
  assert.ok(repairHistory.some(message => message.content.includes('[study] Task requirements')));
  assert.ok(!repairHistory.some(message => message.content.includes('stale anchor')));

  const longOld = 'old implementation line\n'.repeat(12);
  const longNew = 'new implementation line\n'.repeat(12);
  const editBlock = `\`\`\`python
# path: branching_tree/navigation.py
<<<<<<< SEARCH
${longOld}=======
${longNew}>>>>>>> REPLACE
\`\`\``;
  assert.equal(hasRepeatedSearchReplaceBlock(`${editBlock}\n${editBlock}`), false);
  assert.equal(hasRepeatedSearchReplaceBlock(`${editBlock}\n${editBlock}\n${editBlock}`), true);

  const distinctBlocks = [1, 2, 3].map(n => editBlock.replace('old implementation', `old implementation ${n}`));
  assert.equal(hasRepeatedSearchReplaceBlock(distinctBlocks.join('\n')), false);

  const shortBlock = `\`\`\`python
<<<<<<< SEARCH
x
=======
y
>>>>>>> REPLACE
\`\`\``;
  assert.equal(hasRepeatedSearchReplaceBlock(shortBlock.repeat(4)), false);

  console.log('Output guard tests passed.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
