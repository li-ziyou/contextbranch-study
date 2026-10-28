import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import { hashBytes, safeRelative } from './preparation';
import { StudyFinishedRecord, StudyRunFile } from './types';

export type ResearchPeriodStatus = 'not_started' | 'in_progress' | 'interrupted' | 'interrupted_after_deadline' | 'finished' | 'timed_out' | 'unavailable';
interface CapturedFile { name: string; bytes: Buffer }
export interface ResearchPeriodSummary {
  runId: string; period?: number; taskId?: string; condition?: string;
  capturedAt: string; status: ResearchPeriodStatus;
  activeStateId: string | null; mainStateId: string | null;
  recoveryCapturedAt: string | null;
  missingFiles: string[]; warnings: string[];
  finishedRecord: StudyFinishedRecord | null;
  finishedFilesMatch: boolean | null;
}
function regularBytes(file: string): Buffer | null {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(file) : null; }
  catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
}
function readObject(bytes: Buffer | null): any { try { return bytes ? JSON.parse(bytes.toString('utf8')) : null; } catch { return null; } }
function sensitive(relative: string): boolean {
  return relative.split('/').some(part => /^(?:\.env(?:\..*)?|credentials(?:\.json)?|secrets?(?:\.json)?|\.git|node_modules|private|private_tests|private-grader|reference|\.study-runtime|\.study-builder|__pycache__)$/i.test(part)) || /\.(?:vsix|pyc|tmp)$/i.test(relative);
}
function addTree(root: string, prefix: string, files: CapturedFile[], warnings: string[]): void {
  if (!fs.existsSync(root)) return;
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) { warnings.push(`Skipped non-directory or symlink: ${prefix}`); return; }
  const walk = (dir: string, relative: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (sensitive(rel)) continue;
      if (entry.isSymbolicLink()) { warnings.push(`Skipped symlink: ${prefix}/${rel}`); continue; }
      const source = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) walk(source, rel);
        else { const bytes = regularBytes(source); if (bytes) files.push({ name: `${prefix}/${rel}`, bytes }); }
      } catch (error: any) { warnings.push(`Could not read ${prefix}/${rel}: ${error.code ?? 'read error'}`); }
    }
  };
  walk(root, '');
}
export function researchPeriodStatus(run: StudyRunFile, finished: StudyFinishedRecord | null, recovery: any, now = Date.now()): ResearchPeriodStatus {
  if (finished) return finished.timedOut ? 'timed_out' : 'finished';
  if (!run.startedAt) return 'not_started';
  if (now >= Date.parse(run.startedAt) + run.timeLimitSeconds * 1000) return 'interrupted_after_deadline';
  const heartbeat = Date.parse(recovery?.capturedAt ?? '');
  return !recovery?.windowClosedAt && now - heartbeat < 10_000 ? 'in_progress' : 'interrupted';
}
/** Read a period without switching states, saving editor buffers, or creating a Finish record. */
export function captureResearchPeriod(workspace: string): { files: CapturedFile[]; summary: ResearchPeriodSummary } {
  const files: CapturedFile[] = [];
  const capturedAt = new Date().toISOString();
  const runBytes = regularBytes(path.join(workspace, '.study/run.json'));
  const run = readObject(runBytes) as StudyRunFile | null;
  const summary: ResearchPeriodSummary = { runId: run?.runId ?? path.basename(path.dirname(workspace)), capturedAt, status: 'unavailable', activeStateId: null, mainStateId: null, recoveryCapturedAt: null, missingFiles: [], warnings: [], finishedRecord: null, finishedFilesMatch: null };
  if (!run?.manifest || run.schemaVersion !== 1 || !Array.isArray(run.manifest.submission?.allowedProductionPaths)) { summary.warnings.push('The period run record is missing or invalid.'); return { files, summary }; }
  summary.period = run.period; summary.taskId = run.taskId; summary.condition = run.condition;
  for (const name of ['run.json', 'task.json', 'TASK.md', 'finished.json', 'live-state.json']) {
    const bytes = regularBytes(path.join(workspace, '.study', name));
    if (bytes) files.push({ name: `metadata/${name}`, bytes });
  }
  const recovery = readObject(regularBytes(path.join(workspace, '.study/live-state.json')));
  summary.recoveryCapturedAt = recovery?.capturedAt ?? null;
  const finishedBytes = regularBytes(path.join(workspace, '.study/finished.json'));
  const parsedFinished = readObject(finishedBytes) as StudyFinishedRecord | null;
  const finished = parsedFinished?.schemaVersion === 1 && parsedFinished.runId === run.runId && Number.isFinite(Date.parse(parsedFinished.finishedAt)) && parsedFinished.productionFileHashes && typeof parsedFinished.timedOut === 'boolean' ? parsedFinished : null;
  summary.finishedRecord = finished;
  if (finishedBytes && !finished) summary.warnings.push('The Finish record is incomplete or invalid.');
  summary.status = researchPeriodStatus(run, finished, recovery);
  addTree(path.join(workspace, '.contextbranch'), 'contextbranch', files, summary.warnings);
  addTree(path.join(workspace, '.study/recovery'), 'recovery', files, summary.warnings);
  addTree(path.join(workspace, 'tests'), 'public-tests', files, summary.warnings);
  // Include only task Python source and the declared editable files, not arbitrary workspace secrets.
  const sourceRoots = new Set(run.manifest.submission.allowedProductionPaths.map(relative => relative.split('/')[0]));
  for (const root of sourceRoots) if (safeRelative(root) && !sensitive(root)) {
    const captured: CapturedFile[] = []; addTree(path.join(workspace, root), `workspace/${root}`, captured, summary.warnings);
    files.push(...captured.filter(file => file.name.endsWith('.py')));
  }
  for (const relative of run.manifest.submission.allowedProductionPaths) {
    if (!safeRelative(relative) || sensitive(relative)) { summary.warnings.push(`Invalid declared production path: ${relative}`); continue; }
    if (!regularBytes(path.join(workspace, relative))) summary.missingFiles.push(relative);
  }
  const raw = new Map(files.map(file => [file.name, file.bytes]));
  const state = readObject(raw.get('contextbranch/workspace.json') ?? null);
  summary.mainStateId = state?.mainBranchId ?? null;
  summary.activeStateId = recovery?.activeBranchId ?? state?.activeBranchId ?? null;
  // Materialize each recorded state separately. The active disk tree is never labelled final main.
  for (const file of [...files]) {
    if (!/^contextbranch\/branches\/[^/]+\.json$/.test(file.name)) continue;
    const branch = readObject(file.bytes);
    if (!branch || !/^[A-Za-z0-9_-]+$/.test(branch.id)) { summary.warnings.push(`Invalid state record: ${file.name}`); continue; }
    const prefix = `states/${branch.id}`;
    files.push({ name: `${prefix}/state.json`, bytes: file.bytes });
    const messages = (branch.messageIds ?? []).map((id: string) => readObject(raw.get(`contextbranch/objects/m_${id}.json`) ?? null));
    if (messages.some((message: any) => !message)) summary.warnings.push(`Missing conversation object in state ${branch.id}`);
    files.push({ name: `${prefix}/messages.json`, bytes: Buffer.from(JSON.stringify(messages, null, 2)) });
    for (const id of branch.artifactIds ?? []) {
      const artifact = readObject(raw.get(`contextbranch/objects/a_${id}.json`) ?? null);
      if (!artifact) { summary.warnings.push(`Missing artifact ${id} in state ${branch.id}`); continue; }
      if (!safeRelative(artifact.path) || sensitive(artifact.path) || typeof artifact.content !== 'string') continue;
      files.push({ name: `${prefix}/files/${artifact.path}`, bytes: Buffer.from(artifact.content) });
    }
  }
  if (finished?.productionFileHashes) {
    summary.finishedFilesMatch = run.manifest.submission.allowedProductionPaths.every(relative => {
      const captured = raw.get(`workspace/${relative}`);
      return captured && hashBytes(captured) === finished.productionFileHashes[relative];
    });
    if (!summary.finishedFilesMatch) summary.warnings.push('Current workspace files differ from the recorded Finish hashes. The original completion ZIP, when available, is preserved separately.');
  }
  return { files, summary };
}
export async function createSessionResearchPackage(sessionDirectory: string, destination: string): Promise<{ filePath: string; periods: ResearchPeriodSummary[] }> {
  if (fs.existsSync(destination)) throw new Error('Choose a new ZIP filename. Existing research exports are preserved.');
  const sessionBytes = regularBytes(path.join(sessionDirectory, 'session.json'));
  const session = readObject(sessionBytes);
  const directories = fs.readdirSync(sessionDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
  const workspaces = session?.periods?.map((period: any) => period.workspace) ?? directories.filter(dir => regularBytes(path.join(sessionDirectory, dir, 'workspace/.study/run.json'))).map(dir => `${dir}/workspace`);
  if (!Array.isArray(workspaces) || workspaces.length === 0) throw new Error('No study task records were found in this session folder.');
  const files: CapturedFile[] = [];
  if (sessionBytes) files.push({ name: 'metadata/session.json', bytes: sessionBytes });
  const periods: ResearchPeriodSummary[] = [];
  for (const relative of workspaces) {
    if (typeof relative !== 'string' || !safeRelative(relative)) throw new Error('Invalid period workspace path in the session record.');
    const workspace = path.join(sessionDirectory, relative);
    // Do not follow a workspace directory symlink into unrelated files.
    let cursor = sessionDirectory;
    for (const part of relative.split('/')) { cursor = path.join(cursor, part); if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Study workspace paths must not be symlinks.'); }
    let captured: ReturnType<typeof captureResearchPeriod>;
    try { captured = captureResearchPeriod(workspace); } catch (error: any) { captured = { files: [], summary: { runId: path.basename(path.dirname(workspace)), capturedAt: new Date().toISOString(), status: 'unavailable', activeStateId: null, mainStateId: null, recoveryCapturedAt: null, missingFiles: [], warnings: [`Could not capture this period: ${error.code ?? error.message}`], finishedRecord: null, finishedFilesMatch: null } }; }
    const prefix = `periods/${periods.length + 1}`;
    files.push(...captured.files.map(file => ({ ...file, name: `${prefix}/${file.name}` })));
    files.push({ name: `${prefix}/metadata/export-state.json`, bytes: Buffer.from(JSON.stringify(captured.summary, null, 2)) });
    periods.push(captured.summary);
  }
  addTree(path.join(sessionDirectory, 'participant-exports'), 'completion-archives', files, []);
  const inventory = files.map(file => ({ path: file.name, sha256: hashBytes(file.bytes), bytes: file.bytes.length }));
  const manifest = { schemaVersion: 1, archiveKind: 'contextbranch-research-package', exportedAt: new Date().toISOString(), participantId: session?.participantId ?? null, group: session?.group ?? null, periods, files: inventory };
  files.push({ name: 'metadata/export.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2)) });
  files.push({ name: 'README.txt', bytes: Buffer.from('This is a research snapshot, not an automatic task completion.\nmetadata/export.json records each period status and file hashes.\nperiods/N/workspace is the saved disk state at export; states/ contains recorded conversation-code states.\nmetadata/live-state.json and recovery/ preserve unsaved editor text, unapplied proposals and partial model replies.\ncompletion-archives/ preserves original Finish/timeout ZIPs when available.\nExternal screen/audio recordings and survey responses are collected separately.\n') });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(temporary, { flags: 'wx' });
      const zip = archiver('zip', { zlib: { level: 9 } });
      output.once('close', resolve); output.once('error', reject); zip.once('error', reject); zip.once('warning', reject);
      zip.pipe(output);
      for (const file of files) zip.append(file.bytes, { name: file.name });
      void zip.finalize().catch(reject);
    });
    // COPYFILE_EXCL also supports external/network drives without hard links.
    fs.copyFileSync(temporary, destination, fs.constants.COPYFILE_EXCL); fs.unlinkSync(temporary);
  } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  return { filePath: destination, periods };
}
