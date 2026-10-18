#!/usr/bin/env node
/**
 * Clean-install smoke test: `npm pack` this repo, install the tarball into a
 * fresh temp project OUTSIDE the repo, and exercise the CLI end to end:
 * --help, init, index, check, export (size), doctor, canvas (fetch / + API).
 *
 * Usage: node .github/scripts/pack-smoke.mjs [--keep]
 * Assumes `npm run build` already ran. Exits non-zero on any failure.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const isWin = process.platform === 'win32';
const keep = process.argv.includes('--keep');
const results = [];

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
      env: { ...process.env, FORCE_COLOR: '0' },
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
  // Run the installed bin directly with node (not via npx) so killing the
  // child really stops the server instead of orphaning a grandchild.
  const bin = join(cwd, 'node_modules', 'flowlens', 'dist', 'cli', 'index.js');
  const child = spawn(process.execPath, [bin, 'canvas', '--no-open', '--port', '0'], {
    cwd,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  try {
    const url = await new Promise((ok, fail) => {
      let buf = '';
      const timer = setTimeout(() => fail(new Error(`canvas did not start:\n${buf}`)), 60_000);
      const onData = (d) => {
        buf += d;
        const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (m) {
          clearTimeout(timer);
          ok(m[0]);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', (c) => fail(new Error(`canvas exited ${c}:\n${buf}`)));
      child.on('error', fail);
    });
    console.log(`canvas up at ${url}`);
    const get = (u) => fetch(new URL(u, url), { signal: AbortSignal.timeout(15_000) });
    const page = await get('/');
    const html = await page.text();
    if (page.status !== 200 || !html.includes('id="root"')) throw new Error(`GET / → ${page.status}`);
    const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
    const assetRes = asset ? await get(asset) : null;
    if (!assetRes || assetRes.status !== 200) throw new Error(`asset ${asset} not served`);
    const api = await get('/flowlens-api/summary');
    const summary = await api.json();
    if (api.status !== 200 || !(summary.entity_count > 0)) throw new Error('API summary empty');
    results.push({ step: `canvas: GET / 200, ${asset} 200, /flowlens-api/summary entities=${summary.entity_count}`, code: 0, ms: 0 });
  } finally {
    child.kill();
    child.stdout.destroy();
    child.stderr.destroy();
  }
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
  await canvasSmoke(proj);

  console.table(results);
  console.log('pack smoke: OK', readdirSync(proj).join(' '));
} catch (err) {
  console.table(results);
  console.error(`pack smoke: FAILED — ${err.message}`);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(work, { recursive: true, force: true });
  else console.log(`kept ${work}`);
}
