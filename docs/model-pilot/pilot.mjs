/** Bounded branch pilot using GitChat's prompt, history, and edit functions. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const values = {};
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (!flag.startsWith('--')) throw new Error(`Expected a flag, received ${flag}`);
  const name = flag.slice(2);
  if (['list', 'self-test'].includes(name)) values[name] = true;
  else {
    if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    (values[name] ??= []).push(process.argv[++index]);
  }
}
const option = (name, fallback) => values[name]?.at(-1) ?? fallback;
const source = path.resolve(option('source', '.'));
const base = new URL(option('url', process.env.LITELLM_PROXY_URL ?? 'https://litellm.labs.jb.gg/'));
if (base.protocol !== 'https:') throw new Error('Use an HTTPS LiteLLM gateway.');
base.pathname = base.pathname.replace(/\/?(?:v1)?\/?$/, '') + '/v1/';
const headers = { 'Content-Type': 'application/json' };
if (process.env.LITELLM_API_KEY) headers.Authorization = `Bearer ${process.env.LITELLM_API_KEY}`;

async function request(route, body) {
  const response = await fetch(new URL(route, base), {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Gateway HTTP ${response.status} on ${route}`);
  return await response.json();
}

if (values.list) {
  const catalog = await request('models');
  console.log(JSON.stringify(catalog.data.map(model => model.id), null, 2));
  process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitchat-small-model-'));
try {
  const require = createRequire(path.join(source, 'package.json'));
  const esbuild = require('esbuild');
  const bundle = path.join(temporary, 'bridge.mjs');
  const imports = [
    ['CodingAgent', 'src/agents/coding.ts'],
    ['parseEdits, applyEdits', 'src/core/edits.ts'],
  ].map(([names, file]) => `export { ${names} } from ${JSON.stringify(path.join(source, file))};`).join('\n');
  await esbuild.build({ stdin: { contents: imports, resolveDir: source, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
  const { CodingAgent, parseEdits, applyEdits } = await import(pathToFileURL(bundle));

  function applyReply(text, current, owned) {
    const operations = parseEdits(text);
    const outside = operations.filter(operation => !owned.includes(operation.path));
    if (outside.length) return { accepted: false, reason: 'scope', outside: outside.length };
    if (!operations.length) return { accepted: false, reason: 'no_edits' };
    const applied = applyEdits(operations, new Map(Object.entries(current)));
    if (applied.some(file => file.failedCount)) return { accepted: false, reason: 'anchor_or_format' };
    return { accepted: true, files: Object.fromEntries(applied.map(file => [file.path, file.after])) };
  }

  const capture = { async *stream(options) { this.options = options; yield { type: 'done' }; } };
  async function compose(files, history, side, context) {
    const instructions = history.filter(message => message.role === 'system');
    const user = history.filter(message => message.role === 'user');
    const selectedHistory = context === 'history' ? history : [...instructions, ...user.slice(0, 1), ...user.slice(-1)];
    const uniqueHistory = [...new Map(selectedHistory.map(message => [message.id, message])).values()];
    const agent = new CodingAgent(capture);
    for await (const ignored of agent.streamReply({
      branch: { id: 'pilot', name: `Responsibility ${side}`, description: `Implement only Responsibility ${side}` },
      parentBranchName: 'main', isMain: false, history: uniqueHistory,
      workspaceFiles: Object.entries(files).map(([name, content]) => ({ path: name, size: content.length, symbols: [] })),
      selectedFiles: Object.entries(files).map(([name, content]) => ({ path: name, content })),
      artifacts: [],
    })) { /* Capture the request produced by the real coding agent. */ }
    return [{ role: 'system', content: capture.options.system }, ...capture.options.messages];
  }

  if (values['self-test']) {
    const assert = await import('node:assert/strict');
    const files = { 'a.py': 'x = 1\n', 'b.py': 'y = 1\n' };
    const edit = '```python\n# path: a.py\n<<<<<<< SEARCH\nx = 1\n=======\nx = 2\n>>>>>>> REPLACE\n```';
    assert.equal(applyReply(edit, files, ['a.py']).files['a.py'], 'x = 2\n');
    assert.equal(applyReply(edit.replace('a.py', 'b.py'), files, ['a.py']).reason, 'scope');
    assert.equal(applyReply(edit.replace('x = 1', 'old = 1'), files, ['a.py']).reason, 'anchor_or_format');
    assert.equal(applyReply('Done.', files, ['a.py']).reason, 'no_edits');
    const history = [
      { id: 'ticket', role: 'system', content: '[study] Branch A ticket' },
      { id: 'first', role: 'user', content: 'Implement A.' },
      { id: 'old', role: 'assistant', content: 'Obsolete code draft' },
      { id: 'last', role: 'user', content: 'Latest failing assertion' },
    ];
    const messages = await compose(files, history, 'A', 'compact');
    const text = JSON.stringify(messages);
    for (const expected of ['Branch A ticket', 'Implement A.', 'Latest failing assertion', 'x = 1']) {
      assert.ok(text.includes(expected));
    }
    assert.ok(!text.includes('Obsolete code draft'));
    console.log('Pilot checks passed. Current files, branch ticket, failed assertion, and edit validation verified.');
    process.exitCode = 0;
  } else {
    const models = values.model ?? [];
    if (!models.length) throw new Error('Use --list, then supply one or more --model values from the gateway.');
    const catalog = await request('models');
    const available = new Set(catalog.data.map(model => model.id));
    for (const model of models) if (!available.has(model)) throw new Error(`Model is absent from gateway catalog: ${model}`);
    const contexts = values.context ?? ['history', 'compact'];
    if (contexts.some(context => !['history', 'compact'].includes(context))) throw new Error('Unknown context variant.');
    const grading = option('grading', 'source');
    if (!['source', 'original', 'candidate', 'minimal', 'proposed'].includes(grading)) throw new Error('Unknown grading variant.');
    const turns = Number(option('turns', '3'));
    const repeats = Number(option('repeats', '2'));
    const maxTokens = Number(option('max-tokens', '16384'));
    if (![turns, repeats, maxTokens].every(value => Number.isInteger(value) && value > 0) || turns > 5 || repeats > 5) {
      throw new Error('Use positive integer limits, with at most five turns and five repetitions.');
    }
    const output = path.resolve(option('out', 'pilot-results.jsonl'));
    if (fs.existsSync(output)) throw new Error('Choose a new output path for this run.');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const python = path.resolve(option('python', path.join(source, '.study-runtime/bin/python')));
    const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
    const tasks = values.task ?? ['tree-node-navigation', 'exception-group-matcher'];
    const sides = values.side ?? ['A', 'B'];
    const forms = values.form ?? ['F1', 'F2'];
    if (tasks.some(task => !['tree-node-navigation', 'exception-group-matcher'].includes(task)) ||
        sides.some(side => !['A', 'B'].includes(side)) || forms.some(form => !['F1', 'F2'].includes(form))) {
      throw new Error('Unknown task, side, or form filter.');
    }
    for (const model of models) for (const context of contexts) for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const task of tasks) for (const side of sides) for (const form of forms) {
        const root = fs.mkdtempSync(path.join(temporary, 'case-'));
        const privateRoot = path.join(source, 'participant-bundles', task, 'private');
        const taskVersion = readJson(path.join(source, 'participant-bundles', task, 'participant/.study/task.json')).taskVersion ?? 'unversioned';
        fs.cpSync(path.join(privateRoot, 'mutation'), root, { recursive: true });
        fs.cpSync(path.join(source, 'participant-bundles', task, 'participant/tests'), path.join(root, 'tests'), { recursive: true });
        const allowed = readJson(path.join(privateRoot, 'grading.json')).allowedProductionPaths;
        const owned = [allowed[side === 'A' ? 0 : 1]];
        const prepareGrading = spawnSync(python, ['-c', [
          'import sys', 'from pathlib import Path', 'from audit_tests import candidate_tests',
          'from candidate_v3 import minimal_tests, proposed_tests',
          'folder, task, target, variant = sys.argv[1:]',
          'bundle = Path(folder).parent.parent',
          'tests = {label + "/" + p.name: p.read_text() for label, directory in (("private", Path(folder)), ("public", bundle / "participant/tests")) for p in directory.glob("*.py")}',
          'builders = {"candidate": candidate_tests, "minimal": minimal_tests, "proposed": proposed_tests}',
          'tests = builders[variant](task, tests) if variant not in ("original", "source") else tests',
          'Path(target).mkdir()',
          'for name, text in tests.items():',
          '    destination = Path(target) if name.startswith("private/") else Path(target).parent / "tests"',
          '    (destination / Path(name).name).write_text(text)',
        ].join('\n'), path.join(privateRoot, 'hidden_tests'), task, path.join(root, 'grading'), grading], {
          encoding: 'utf8', timeout: 10_000,
          env: { ...process.env, PYTHONPATH: path.dirname(fileURLToPath(import.meta.url)), PYTHONDONTWRITEBYTECODE: '1' },
        });
        if (prepareGrading.status !== 0) throw new Error('Could not prepare the evaluator-only tests.');
        const filePaths = fs.readdirSync(path.join(root, path.dirname(owned[0])))
          .filter(name => name.endsWith('.py')).map(name => path.posix.join(path.dirname(owned[0]), name));
        const files = () => Object.fromEntries(filePaths.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
        const check = (suite = `tests/test_responsibility_${side.toLowerCase()}.py`) => {
          const result = spawnSync(python, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '--junitxml=check.xml', suite], {
            cwd: root, encoding: 'utf8', timeout: 15_000,
            env: { ...process.env, PYTHONPATH: root, PYTHONDONTWRITEBYTECODE: '1', PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', CONTEXTBRANCH_STUDY_FORM_ID: form },
          });
          const xml = path.join(root, 'check.xml');
          const skipped = fs.existsSync(xml) && fs.readFileSync(xml, 'utf8').includes('<skipped');
          return { code: result.error || skipped ? 'runner_error' : result.status,
            output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(-6000) };
        };
        const initial = check();
        if (initial.code !== 1) throw new Error(`Expected an initially failing check for ${task} ${side} ${form}`);
        const ticket = fs.readFileSync(path.join(source, 'evaluation/study2/tasks', task, `branch-${side.toLowerCase()}.md`), 'utf8');
        const history = [{ id: 'ticket', role: 'system', content: `[study]\n${ticket}\nWrite only ${owned[0]}. Other files supply interface context.` }];
        let feedback = '';
        for (let turn = 1; turn <= turns; turn++) {
          history.push({ id: `u${turn}`, role: 'user', content: turn === 1 ? `Implement this branch's ticket in ${owned[0]}.` : `Fix this branch using the current files.\n${feedback}` });
          const messages = await compose(files(), history, side, context);
          const start = Date.now();
          let response;
          try {
            response = await request('chat/completions', { model, messages, max_tokens: maxTokens, stream: false, fallbacks: [] });
          } catch (error) {
            fs.appendFileSync(output, JSON.stringify({ model, context, repeat, task, taskVersion, side, form, turn, status: 'provider_error', error: error.message }) + '\n');
            break;
          }
          const modelLatencyMs = Date.now() - start;
          const choice = response.choices?.[0];
          const text = choice?.message?.content;
          let applied = { accepted: false, reason: 'unfinished_response' };
          if (choice?.finish_reason === 'stop' && typeof text === 'string') applied = applyReply(text, files(), owned);
          if (applied.accepted) for (const [name, content] of Object.entries(applied.files)) fs.writeFileSync(path.join(root, name), content);
          const result = check();
          fs.appendFileSync(output, JSON.stringify({ model, returnedModel: response.model, context, repeat, task, taskVersion, side, form, turn,
            finishReason: choice?.finish_reason, accepted: applied.accepted, rejection: applied.reason,
            scopeProposals: applied.outside ?? 0, exitCode: result.code, modelLatencyMs, turnLatencyMs: Date.now() - start,
            usage: response.usage, inputChars: JSON.stringify(messages).length, outputChars: typeof text === 'string' ? text.length : 0 }) + '\n');
          history.push({ id: `a${turn}`, role: 'assistant', content: typeof text === 'string' ? text : '',
            meta: choice?.finish_reason === 'stop'
              ? { artifactIds: parseEdits(typeof text === 'string' ? text : '').map(operation => operation.path) }
              : { interrupted: true } });
          if (result.code === 0 || result.code !== 1) break;
          feedback = `${applied.reason ?? 'The patch applied, but the check failed.'}\n${result.output}`;
        }
        const privateSuite = {
          'tree-node-navigation': { A: 'test_structure_integrity.py', B: 'test_path_navigation.py' },
          'exception-group-matcher': { A: 'test_leaf_matching.py', B: 'test_group_matching.py' },
        }[task][side];
        const finalGrade = check(`grading/${privateSuite}`);
        fs.appendFileSync(output, JSON.stringify({ model, context, repeat, task, taskVersion, side, form,
          phase: 'final_private_evaluation', grading, exitCode: finalGrade.code }) + '\n');
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    console.log(`Pilot results written to ${output}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
