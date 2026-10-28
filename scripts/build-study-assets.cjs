const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
function buildStudyAssets(root = path.resolve(__dirname, '..')) {
  const study = path.join(root, 'evaluation', 'study2');
  const destination = path.join(root, 'study-assets');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const taskSet = JSON.parse(fs.readFileSync(path.join(study, 'operator/task-sets/study2-v2.json'), 'utf8'));
  const copy = (source, target) => {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Study asset is a symlink: ${source}`);
    if (stat.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(source)) if (name !== '__pycache__' && !name.endsWith('.pyc')) copy(path.join(source, name), path.join(target, name));
    } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  };
  for (const taskId of taskSet.taskIds) {
    const full = JSON.parse(fs.readFileSync(path.join(study, 'manifests', `${taskId}.json`), 'utf8'));
    const dir = path.join(destination, 'tasks', taskId);
    copy(path.join(study, full.assets.baselineDirectory), path.join(dir, 'baseline'));
    copy(path.join(study, 'public-tests', taskId), path.join(dir, 'tests'));
    copy(path.join(study, full.ticket.mainTicketFile), path.join(dir, 'TASK.md'));
    const { assets, privateGrader, ...publicManifest } = full;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(publicManifest, null, 2) + '\n');
  }
  copy(path.join(study, 'runner/study_runner.py'), path.join(destination, 'runner/study_runner.py'));
  const files = {};
  function hash(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) hash(file);
      else files[path.relative(destination, file).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  hash(destination);
  let sourceRevision = 'unknown';
  try { sourceRevision = child.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
  fs.writeFileSync(path.join(destination, 'index.json'), JSON.stringify({ schemaVersion: 1, extensionVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, sourceRevision, taskSet, files }, null, 2) + '\n');
  return destination;
}
if (require.main === module) console.log(buildStudyAssets());
module.exports = { buildStudyAssets };
