import type { FileChurnData } from '../contracts/analysis/churn.js';
import { runGit } from './git.js';

const COMMIT_MARKER = '--flowlens-commit--';

/**
 * Per-file churn over the last `period_days` from `git log`, with the real
 * date of the most recent change. One git invocation: commits are listed
 * newest-first, so the first date seen for a file is its `last_changed`.
 * `--relative` keeps paths relative to `rootDir` even when the project is a
 * subdirectory of the repository (and drops files outside it).
 */
export async function computeChurn(
  rootDir: string,
  options?: { period_days?: number; since?: string },
): Promise<Map<string, FileChurnData>> {
  const days = options?.period_days ?? 90;
  const result = new Map<string, FileChurnData>();

  const sinceArg = options?.since ?? `${days} days ago`;
  const output = runGit(
    ['log', `--format=${COMMIT_MARKER}%aI`, '--name-only', '--relative', `--since=${sinceArg}`],
    rootDir,
  );
  if (output === null) return result; // not a git repo or git unavailable

  const counts = new Map<string, number>();
  const lastChanged = new Map<string, string>();
  let currentDate = '';
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(COMMIT_MARKER)) {
      currentDate = trimmed.slice(COMMIT_MARKER.length);
      continue;
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    if (!lastChanged.has(trimmed)) lastChanged.set(trimmed, currentDate);
  }

  for (const [file, count] of counts) {
    result.set(file, {
      file,
      change_count: count,
      period_days: days,
      churn_rate: count / days,
      last_changed: lastChanged.get(file) ?? '',
    });
  }

  return result;
}
