import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { hashBytes, writeJsonAtomic } from './preparation';
const execFileAsync = promisify(execFile);
const UV_VERSION = '0.13.6';
export const STUDY_PYTHON_VERSION = '3.14.0';
export const STUDY_PYTEST_VERSION = '9.2.0';
const builds: Record<string, { triple: string; sha256: string }> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', sha256: '60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', sha256: '63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02' },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', sha256: 'c2426c0c8e28b53d8c440e47a18d96ad4db51e159866c0e81435b196d7f0081c' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', sha256: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-gnu', sha256: '229e194255c7958d86d56e8790d969a6f74736592133f0dfd0076f754c642c1d' },
  'linux-x64': { triple: 'x86_64-unknown-linux-gnu', sha256: 'f29c3e94ffabd7e6f3ba521dba169a9b7ec12100bf3257087f0f24f6123f3645' },
};
export function runtimeBuild(platform: string = process.platform, arch: string = process.arch) {
  const build = builds[`${platform}-${arch}`];
  if (!build) throw new Error(`The study installer supports Windows, macOS, and Linux on Intel/AMD 64-bit or ARM64. This computer reports ${platform}/${arch}.`);
  const archive = `uv-${build.triple}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  return { ...build, archive, url: `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archive}` };
}
export function downloadRuntime(url: string, redirects = 0): Promise<Buffer> {
  if (redirects > 6 || !url.startsWith('https://')) return Promise.reject(new Error('Invalid runtime download redirect.'));
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'GitChat-Study-Setup' } }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume(); void downloadRuntime(new URL(response.headers.location, url).href, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Runtime download returned HTTP ${response.statusCode}. Check the internet connection and try setup again.`)); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 100 * 1024 * 1024) { request.destroy(new Error('Runtime download exceeded the expected size.')); return; } chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(120_000, () => request.destroy(new Error('Runtime download timed out. Check the internet connection and try setup again.')));
    request.on('error', reject);
  });
}
function findExecutable(directory: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return file;
    if (entry.isDirectory()) { const found = findExecutable(file, name); if (found) return found; }
  }
  return undefined;
}
export async function ensureStudyRuntime(root: string, progress: (message: string) => void = () => {}): Promise<string> {
  const platform = process.platform;
  const build = runtimeBuild();
  fs.mkdirSync(root, { recursive: true });
  const python = path.join(root, 'python-env', platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const check = async () => {
    const result = await execFileAsync(python, ['-I', '-c', 'import sys,pytest; assert sys.version_info[:3] == (3,14,0); assert pytest.__version__ == "9.2.0"'], { timeout: 30_000, windowsHide: true });
    return result;
  };
  if (fs.existsSync(python)) { try { await check(); return python; } catch { /* Resume an interrupted dependency installation below. */ } }
  const uvRoot = path.join(root, `uv-${UV_VERSION}`);
  let uv = fs.existsSync(uvRoot) ? findExecutable(uvRoot, platform === 'win32' ? 'uv.exe' : 'uv') : undefined;
  if (!uv) {
    progress('Downloading the study environment manager…');
    const bytes = await downloadRuntime(build.url);
    if (hashBytes(bytes) !== build.sha256) throw new Error('The environment manager download failed its SHA-256 check. Try setup again.');
    const scratch = fs.mkdtempSync(path.join(root, '.download-'));
    try {
      const archive = path.join(scratch, build.archive); fs.writeFileSync(archive, bytes);
      const extracted = path.join(scratch, 'extracted'); fs.mkdirSync(extracted);
      if (platform === 'win32') {
        const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
        await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)}`], { timeout: 120_000, windowsHide: true });
      } else await execFileAsync('tar', ['-xzf', archive, '-C', extracted], { timeout: 120_000 });
      fs.mkdirSync(uvRoot, { recursive: true }); fs.cpSync(extracted, uvRoot, { recursive: true });
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    uv = findExecutable(uvRoot, platform === 'win32' ? 'uv.exe' : 'uv');
    if (!uv) throw new Error('The environment manager executable was not found after extraction.');
  }
  if (platform !== 'win32') fs.chmodSync(uv, 0o755);
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(root, 'python-downloads'), UV_PYTHON_INSTALL_BIN: '0', UV_CACHE_DIR: path.join(root, 'cache'), UV_NO_CONFIG: '1', UV_NATIVE_TLS: 'true' };
  progress('Preparing the isolated Python environment…');
  if (!fs.existsSync(python)) await execFileAsync(uv, ['venv', '--managed-python', '--python', STUDY_PYTHON_VERSION, '--seed', path.join(root, 'python-env')], { env, timeout: 600_000, windowsHide: true, maxBuffer: 2_000_000 });
  progress('Installing the public test runner…');
  await execFileAsync(uv, ['pip', 'install', '--python', python, `pytest==${STUDY_PYTEST_VERSION}`], { env, timeout: 300_000, windowsHide: true, maxBuffer: 2_000_000 });
  await check();
  writeJsonAtomic(path.join(root, 'environment.json'), { python: STUDY_PYTHON_VERSION, pytest: STUDY_PYTEST_VERSION, uv: UV_VERSION, platform, arch: os.arch(), preparedAt: new Date().toISOString() });
  return python;
}
