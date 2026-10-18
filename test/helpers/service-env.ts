/**
 * Test helpers for the graph service: isolated $FLOWLENS_HOME, fixture
 * copies, and launching the CLI from source through tsx.
 */
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = resolve(__dirname, '..', '..');
export const CLI_TS = join(REPO, 'src', 'cli', 'index.ts');
/** Absolute tsx loader URL so children can run from any cwd. */
export const TSX_LOADER = pathToFileURL(join(REPO, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

export async function tempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

/** Copy `test/fixtures/<name>` into a fresh temp dir and return its path. */
export async function copyFixture(name: string, parent?: string): Promise<string> {
  const base = parent ?? (await tempDir('flowlens-proj-'));
  const dest = join(base, name);
  await cp(join(REPO, 'test', 'fixtures', name), dest, { recursive: true });
  return dest;
}

export async function removeDir(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `flowlens <args>` from source (tsx) in `cwd` with extra env. */
export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}, timeoutMs = 60_000): Promise<CliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, CLI_TS, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}
