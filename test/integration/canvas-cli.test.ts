/**
 * `flowlens canvas` through the real CLI (tsx): auto-starts the daemon,
 * registers the project, prints a one-time sign-in URL that lands on the
 * project's Health tab; outside a project it lands on Home; `--watch`
 * keeps running and re-indexes on file changes (the old LevelDB-lock crash).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import type { ProjectDetail } from '../../src/contracts/service.js';
import { CLI_TS, TSX_LOADER, copyFixture, removeDir, runCli, tempDir } from '../helpers/service-env.js';

const urlIn = (out: string) => /(http:\/\/127\.0\.0\.1:\d+\/auth\?t=[^\s]+)/.exec(out)?.[1] ?? '';

describe('flowlens canvas', () => {
  let home: string;
  let env: Record<string, string>;
  let root: string;

  beforeAll(async () => {
    home = await tempDir('flowlens-home-');
    env = { FLOWLENS_HOME: home, FLOWLENS_NO_DAEMON: '', FLOWLENS_DAEMON_PORT: '0' };
    root = await copyFixture('layered-project');
    const init = await runCli(['init'], root, env, 120_000);
    expect(init.code, init.stderr + init.stdout).toBe(0);
  }, 150_000);

  afterAll(async () => {
    await runCli(['daemon', 'stop'], home, env);
    await removeDir(home);
    await removeDir(join(root, '..'));
  });

  it('prints a sign-in URL that opens the project Health tab', async () => {
    const r = await runCli(['canvas', '--no-open'], root, env, 60_000);
    expect(r.code, r.stderr).toBe(0);
    const url = urlIn(r.stdout);
    expect(url).not.toBe('');
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(303);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toMatch(/^\/#\/p\/[^/]+\/health$/);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const origin = new URL(url).origin;
    const projects = (await (await fetch(`${origin}/api/projects`, { headers: { Cookie: cookie } })).json()) as ProjectDetail[];
    expect(projects.map((p) => p.root)).toContain(root);
    expect(loc).toContain(projects.find((p) => p.root === root)!.id);
  }, 90_000);

  it('opening the browser never puts the sign-in code in its argv (review M2)', async () => {
    if (process.platform === 'win32') return;
    // A fake `xdg-open`/`open` that records its arguments.
    const bin = join(home, 'fake-bin');
    const argvLog = join(home, 'browser-argv.txt');
    await mkdir(bin, { recursive: true });
    for (const name of ['xdg-open', 'open']) {
      await writeFile(join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\n`, { mode: 0o755 });
    }
    const r = await runCli(['canvas'], root, { ...env, PATH: `${bin}:${process.env.PATH}` }, 60_000);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/auth\?t=/);
    let argv = '';
    for (let i = 0; i < 100 && !argv; i++) {
      argv = await readFile(argvLog, 'utf8').catch(() => '');
      if (!argv) await sleep(50);
    }
    const opened = argv.trim();
    expect(opened).not.toMatch(/t=|auth/);
    expect(opened.startsWith(join(home, 'run', 'open-'))).toBe(true);
    expect(statSync(opened).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'run')).mode & 0o777).toBe(0o700);
    const html = await readFile(opened, 'utf8');
    const url = /location\.replace\("([^"]+)"\)/.exec(html)?.[1] ?? '';
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\?t=/);
    const res = await fetch(url, { redirect: 'manual' });
    expect(res.status).toBe(303);
  }, 90_000);

  it('outside a project it opens Home', async () => {
    const r = await runCli(['canvas', '--no-open'], home, env, 60_000);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('flowlens init');
    const res = await fetch(urlIn(r.stdout), { redirect: 'manual' });
    expect(res.headers.get('location')).toBe('/#/home');
  }, 60_000);

  it('--watch keeps running and re-indexes changed files through the daemon', async () => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, CLI_TS, 'canvas', '--no-open', '--watch', '--debounce', '50'], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    try {
      await waitFor(() => out.includes('Watching for changes'), 60_000, () => out);
      await writeFile(join(root, 'services', 'added-later.ts'), 'export const addedLater = 1;\n');
      await waitFor(() => /updated: [1-9]\d* re-parsed/.test(out), 30_000, () => out);
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill('SIGINT');
      await new Promise((r) => child.once('exit', r));
    }
  }, 120_000);
});

async function waitFor(cond: () => boolean, timeoutMs: number, dump: () => string): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out; output:\n${dump()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
