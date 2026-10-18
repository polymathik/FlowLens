/**
 * Locations shared by the project registry and the graph service.
 * `$FLOWLENS_HOME` (default `~/.flowlens`) holds user-level state;
 * each project's graph stays in `<root>/.flowlens/`.
 */
import { realpathSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLOWLENS_HOME_ENV } from '../contracts/projects.js';

export function flowlensHome(): string {
  const override = process.env[FLOWLENS_HOME_ENV];
  return override && override.trim() !== '' ? resolve(override) : join(homedir(), '.flowlens');
}

/** Create `$FLOWLENS_HOME` (mode 0700 — it holds the daemon token). */
export function ensureFlowlensHome(): string {
  const dir = flowlensHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function registryPath(): string {
  return join(flowlensHome(), 'projects.json');
}

/** Canonical absolute path (realpath when it exists, else resolved). */
export function canonicalRoot(root: string): string {
  const abs = resolve(root);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}

export function projectFlowlensDir(root: string): string {
  return join(root, '.flowlens');
}

export function projectGraphPath(root: string): string {
  return join(root, '.flowlens', 'graph');
}
