/**
 * Minimal local git helpers for analysis (no shell: arguments go straight to
 * execFileSync, so user-supplied refs can't inject commands).
 */

import { execFileSync } from 'node:child_process';

export function runGit(args: string[], cwd: string, timeoutMs = 30000): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** Full SHA of HEAD, or null outside a git repo / before the first commit. */
export function headSha(cwd: string): string | null {
  return revParseCommit('HEAD', cwd);
}

/** Resolve any commit-ish (short SHA, HEAD~1, branch, tag) to a full SHA. */
export function revParseCommit(ref: string, cwd: string): string | null {
  if (ref.startsWith('-')) return null;
  const out = runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
  const sha = out?.trim();
  return sha && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}
