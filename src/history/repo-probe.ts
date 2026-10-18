/** Cheap questions about the git repository a project lives in. */
import { existsSync } from 'node:fs';
import { HistoryError } from '../contracts/history.js';
import { gitOk, gitText } from './git-run.js';

export interface RepoProbe {
  head: string;
  /** Branch name, or `HEAD` when detached. */
  branch: string;
  /** Project root relative to the repository top (`''` at the top, else `sub/dir/`). */
  prefix: string;
  shallow: boolean;
}

const SHA = /^[0-9a-f]{40,64}$/;

/** HEAD's full sha, or a typed `not_a_git_repo` / `no_commits` error. */
export async function currentHead(rootDir: string, signal?: AbortSignal): Promise<string> {
  if (!existsSync(rootDir)) throw new HistoryError('not_a_git_repo', 'Project directory does not exist');
  const inside = (await gitText(['rev-parse', '--is-inside-work-tree'], rootDir, { signal })).trim();
  if (inside !== 'true') throw new HistoryError('not_a_git_repo', 'This project is not inside a git work tree');
  let out: string;
  try {
    out = (await gitText(['rev-parse', '--verify', '-q', 'HEAD'], rootDir, { signal })).trim();
  } catch (err) {
    if (err instanceof HistoryError && err.code === 'git_failed') throw new HistoryError('no_commits', 'This repository has no commits yet');
    throw err;
  }
  if (!SHA.test(out)) throw new HistoryError('no_commits', 'This repository has no commits yet');
  return out;
}

export async function probeRepo(rootDir: string, signal?: AbortSignal): Promise<RepoProbe> {
  const head = await currentHead(rootDir, signal);
  const lines = (await gitText(['rev-parse', '--show-prefix', '--is-shallow-repository', '--abbrev-ref', 'HEAD'], rootDir, { signal })).split('\n');
  return { head, prefix: lines[0] ?? '', shallow: lines[1]?.trim() === 'true', branch: (lines[2] ?? 'HEAD').trim() || 'HEAD' };
}

/** `ancestor` is reachable from `descendant` (false when either object is gone). */
export const isAncestor = (rootDir: string, ancestor: string, descendant: string, signal?: AbortSignal): Promise<boolean> =>
  gitOk(['merge-base', '--is-ancestor', ancestor, descendant], rootDir, { signal });
