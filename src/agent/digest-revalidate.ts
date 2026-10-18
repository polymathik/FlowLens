/**
 * Decide whether a digest whose LevelDB fingerprint no longer matches still
 * describes the graph, by checking the working tree instead of the graph.
 *
 * The graph only changes because source files change (watcher / guard
 * re-index) or because of a full index / config change (caught by the base
 * fingerprint before we get here). So if no source file the digest knows
 * about changed, and no directory gained or lost entries, since the digest
 * was computed, its content is still what a fresh scan would return.
 *
 * - `read_at - SLACK_MS` is the cutoff: a file edited shortly before the
 *   digest was computed may not have been indexed yet when it was read.
 * - `accounted` lists files (and their directories) the guard re-indexed and
 *   patched into the digest itself, at the mtime it saw — those are known to
 *   be in the digest even though they are newer than the cutoff.
 *
 * Cost: one stat per indexed file and per directory (~50 ms for 10K files).
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentGraphDigest } from './digest.js';

/** Longer than the watcher debounce (300 ms) plus a typical incremental re-index. */
export const REVALIDATE_SLACK_MS = 10_000;

function mtime(path: string): number | null {
  try {
    return Math.trunc(statSync(path).mtimeMs);
  } catch {
    return null;
  }
}

/** Directories containing `files`, with every ancestor up to the root (''). */
export function directoriesOf(files: Iterable<string>): Set<string> {
  const dirs = new Set<string>(['']);
  for (const file of files) {
    for (let dir = dirname(file); dir !== '.' && dir !== '/' && !dirs.has(dir); dir = dirname(dir)) dirs.add(dir);
  }
  return dirs;
}

/**
 * @param patching files the caller is about to re-read from the live graph
 *   and patch into the digest (the guard's changed files) — they, and their
 *   directories, may have changed. Known gap: another new file created in
 *   the same directory in the same window is not noticed until the next
 *   full digest.
 */
export function unchangedSince(rootDir: string, digest: AgentGraphDigest, patching: string[] = []): boolean {
  if (typeof digest.read_at !== 'number') return false;
  const cutoff = digest.read_at - REVALIDATE_SLACK_MS;
  const accounted = digest.accounted ?? {};
  const skip = new Set(patching);
  const skipDirs = new Set([...skip].map((file) => dirname(file)).map((dir) => (dir === '.' ? '' : dir)));
  const files = new Set(digest.entities.map((row) => row[4]));
  for (const file of files) {
    if (skip.has(file)) continue;
    const m = mtime(join(rootDir, file));
    if (m === null) return false; // deleted
    if (m >= cutoff && accounted[file] !== m) return false;
  }
  for (const dir of directoriesOf(files)) {
    if (skipDirs.has(dir)) continue;
    const m = mtime(join(rootDir, dir));
    if (m === null) return false;
    if (m >= cutoff && accounted[`${dir}/`] !== m) return false; // entries added/removed
  }
  return true;
}

/**
 * Record the current mtimes of files the guard just re-indexed (and their
 * directories) so a later revalidation knows the digest already has them.
 * Entries older than the cutoff are dropped (they no longer matter).
 */
export function accountFiles(
  rootDir: string,
  previous: Record<string, number> | undefined,
  files: string[],
  readAt: number,
): Record<string, number> {
  const cutoff = readAt - REVALIDATE_SLACK_MS;
  const out: Record<string, number> = {};
  for (const [key, m] of Object.entries(previous ?? {})) if (m >= cutoff) out[key] = m;
  for (const file of files) {
    const m = mtime(join(rootDir, file));
    if (m !== null) out[file] = m;
  }
  for (const dir of directoriesOf(files)) {
    const m = mtime(join(rootDir, dir));
    if (m !== null) out[`${dir}/`] = m;
  }
  return out;
}
