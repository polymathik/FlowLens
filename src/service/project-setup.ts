/**
 * Project lifecycle helpers used by `init` and `serve`.
 *
 * - `resetFlowlensDir`: `init --force` deletes `.flowlens/`. The daemon may
 *   hold that DB open (e.g. a running `serve`), so evict it first, and keep
 *   `project.json` so the project id (registry, manifest, deep links)
 *   survives the reset.
 * - `autoInit`: `serve` in a project without `.flowlens/` runs `flowlens init`
 *   in a child process with its stdout redirected to our stderr — stdout
 *   belongs to the MCP stdio transport.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { readProjectIdentity } from '../utils/project-identity.js';
import { routePath, SERVICE_ROUTES } from '../contracts/service.js';
import type { ProjectWithStatus } from '../contracts/projects.js';
import { canonicalRoot, projectFlowlensDir } from '../projects/paths.js';
import { restoreProjectIdentity } from '../projects/identity.js';
import { findDaemon } from './autostart.js';
import { cliLaunch } from './runtime.js';
import { daemonDisabled, type OpenGraphOptions } from './open-graph-store.js';

/** Ask a running daemon (never starts one) to stop watching and close a project. */
export async function evictFromDaemon(rootDir: string): Promise<void> {
  const client = await findDaemon();
  if (!client) return;
  try {
    const p = await client.request<ProjectWithStatus>(
      'POST', SERVICE_ROUTES.resolve, { root: canonicalRoot(rootDir), register: false },
    );
    await client.request('POST', routePath(SERVICE_ROUTES.close, { id: p.id }), {});
  } catch {
    // not registered → nothing open
  } finally {
    client.destroy();
  }
}

export async function resetFlowlensDir(rootDir: string, o: OpenGraphOptions = {}): Promise<void> {
  const root = canonicalRoot(rootDir);
  const dir = projectFlowlensDir(root);
  if (!daemonDisabled(o)) await evictFromDaemon(root);
  const identity = readProjectIdentity(dir);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  if (identity) restoreProjectIdentity(dir, root, identity.id);
}

/** Run `flowlens init` for `rootDir` when `.flowlens/` is missing. */
export async function autoInit(rootDir: string, o: OpenGraphOptions = {}): Promise<boolean> {
  const root = canonicalRoot(rootDir);
  if (existsSync(projectFlowlensDir(root))) return false;
  process.stderr.write(`[flowlens] no .flowlens/ in ${root} — indexing now (flowlens init)...\n`);
  const { command, args } = cliLaunch(['init', ...(daemonDisabled(o) ? ['--no-daemon'] : [])]);
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', process.stderr, process.stderr], env: process.env });
    child.on('error', reject);
    child.on('exit', (c) => resolve(c ?? 1));
  });
  if (code !== 0) throw new Error(`automatic "flowlens init" failed (exit ${code})`);
  return true;
}
