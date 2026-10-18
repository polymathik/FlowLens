/**
 * Git revision info for the manifest. Silent outside git repositories
 * (no "fatal: not a git repository" noise on stderr).
 */
import { execFileSync } from 'node:child_process';

export interface GitInfo {
  head: string | null;
  dirty: boolean;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function readGitInfo(rootDir: string): GitInfo {
  const head = git(['rev-parse', 'HEAD'], rootDir);
  if (!head) return { head: null, dirty: false };
  const status = git(['status', '--porcelain', '--untracked-files=no'], rootDir);
  return { head, dirty: !!status };
}
