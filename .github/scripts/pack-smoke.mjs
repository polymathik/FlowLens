#!/usr/bin/env node
/**
 * Clean-install smoke test: `npm pack` this repo, install the tarball into a
 * fresh temp project OUTSIDE the repo, and exercise the CLI end to end:
 * --help, init, index, check, export (size), doctor, report, and the
 * daemon-served explorer: `canvas --no-open` prints a sign-in URL; following
 * it (keeping the session cookie) must return the app and `/api/projects`
 * must list the project. Runs with an isolated FLOWLENS_HOME and an
 * ephemeral daemon port, and stops the daemon at the end.
 *
 * Usage: node .github/scripts/pack-smoke.mjs [--keep]
 * Assumes `npm run build` already ran. Exits non-zero on any failure.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const isWin = process.platform === 'win32';
const keep = process.argv.includes('--keep');
const results = [];
const home = mkdtempSync(join(tmpdir(), 'flowlens-pack-home-'));
const ENV = { ...process.env, FORCE_COLOR: '0', FLOWLENS_HOME: home, FLOWLENS_DAEMON_PORT: '0' };
delete ENV.FLOWLENS_NO_DAEMON;

function run(cmd, args, cwd, { allow = [0] } = {}) {
  const started = Date.now();
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf-8',
      shell: isWin,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ENV,
    });
  } catch (err) {
    code = err.status ?? 1;
    stdout = String(err.stdout ?? '');
    if (!allow.includes(code)) {
      console.error(String(err.stderr ?? ''));
      throw new Error(`${cmd} ${args.join(' ')} exited ${code}`);
    }
  }
  results.push({ step: `${cmd} ${args.join(' ')}`, code, ms: Date.now() - started });
  return stdout;
}

async function canvasSmoke(cwd) {
  const out = run('npx', ['flowlens', 'canvas', '--no-open'], cwd);
  const signIn = out.match(/http:\/\/127\.0\.0\.1:\d+\/auth\?t=[^\s]+/)?.[0];
  if (!signIn) throw new Error(`canvas --no-open printed no sign-in URL:\n${out}`);
  const origin = new URL(signIn).origin;
  const auth = await fetch(signIn, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const cookie = (auth.headers.get('set-cookie') ?? '').split(';')[0];
  const location = auth.headers.get('location');
  if (auth.status !== 303 || !cookie || !location) throw new Error(`/auth → ${auth.status}, no session cookie`);
  const get = (u) => fetch(new URL(u, origin), { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
  const page = await get(location);
  const html = await page.text();
  if (page.status !== 200 || !html.includes('id="root"')) throw new Error(`GET ${location} → ${page.status}`);
  const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
  const assetRes = asset ? await get(asset) : null;
  if (!assetRes || assetRes.status !== 200) throw new Error(`asset ${asset} not served`);
  const api = await get('/api/projects');
  const projects = await api.json();
  if (api.status !== 200 || !Array.isArray(projects) || !projects.some((p) => p.name === 'app')) {
    throw new Error(`/api/projects → ${api.status}: ${JSON.stringify(projects).slice(0, 300)}`);
  }
  results.push({ step: `explorer ${origin}: /auth 303+cookie, ${location} 200, ${asset} 200, /api/projects=${projects.length}`, code: 0, ms: 0 });
}

const work = mkdtempSync(join(tmpdir(), 'flowlens-pack-smoke-'));
try {
  const packJson = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], repo));
  const { filename, files, size, unpackedSize } = packJson[0];
  const bad = files.map((f) => f.path).filter((p) => /^(src|test|benchmarks|vscode-extension)\//.test(p) || p.endsWith('.map'));
  if (bad.length) throw new Error(`tarball contains unexpected files: ${bad.slice(0, 5).join(', ')}`);
  for (const must of ['README.md', 'LICENSE', 'dist/cli/index.js', 'dist/canvas/app/index.html']) {
    if (!files.some((f) => f.path === must)) throw new Error(`tarball is missing ${must}`);
  }
  console.log(`packed ${filename}: ${files.length} files, ${size} B (unpacked ${unpackedSize} B)`);

  const proj = join(work, 'app');
  cpSync(join(repo, 'test', 'fixtures', 'simple-project'), join(proj, 'src'), { recursive: true });
  writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'smoke-app', private: true }));
  run('npm', ['i', '--no-audit', '--no-fund', join(work, filename)], proj);

  run('npx', ['flowlens', '--help'], proj);
  run('npx', ['flowlens', 'init'], proj);
  run('npx', ['flowlens', 'index'], proj);
  run('npx', ['flowlens', 'check'], proj, { allow: [0, 1] });
  const exported = run('npx', ['flowlens', 'export', '--format', 'json'], proj);
  const parsed = JSON.parse(exported);
  results.push({ step: `export json: ${exported.length} chars, ${parsed.entities.length} entities`, code: 0, ms: 0 });
  run('npx', ['flowlens', 'doctor'], proj, { allow: [0, 2] });
  const report = run('npx', ['flowlens', 'report'], proj);
  if (!/Code health report/.test(report)) throw new Error('flowlens report printed no report');
  results.push({ step: `report: ${report.match(/Grade [A-F][^\n]*/)?.[0] ?? '?'}`, code: 0, ms: 0 });
  await canvasSmoke(proj);
  run('npx', ['flowlens', 'daemon', 'status'], proj);

  console.table(results);
  console.log('pack smoke: OK', readdirSync(proj).join(' '));
} catch (err) {
  console.table(results);
  console.error(`pack smoke: FAILED — ${err.message}`);
  process.exitCode = 1;
} finally {
  try {
    execFileSync(process.execPath, [join(work, 'app', 'node_modules', 'flowlens', 'dist', 'cli', 'index.js'), 'daemon', 'stop'], { env: ENV, stdio: 'ignore' });
  } catch { /* not running */ }
  if (!keep) {
    rmSync(work, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
  else console.log(`kept ${work}`);
}
