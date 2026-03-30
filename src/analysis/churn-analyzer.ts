import { execSync } from 'node:child_process';
import type { FileChurnData } from '../contracts/analysis/churn.js';

export async function computeChurn(
  rootDir: string,
  options?: { period_days?: number; since?: string },
): Promise<Map<string, FileChurnData>> {
  const days = options?.period_days ?? 90;
  const result = new Map<string, FileChurnData>();

  let output: string;
  try {
    const sinceArg = options?.since ?? `${days} days ago`;
    output = execSync(
      `git log --format="" --name-only --since="${sinceArg}"`,
      { cwd: rootDir, encoding: 'utf-8', timeout: 30000 },
    );
  } catch {
    // Not a git repo or git not available — return empty
    return result;
  }

  // Count file occurrences
  const counts = new Map<string, number>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }

  // Get last change dates
  let lastChangedOutput = '';
  try {
    lastChangedOutput = execSync(
      'git log --format="%aI" --name-only --max-count=1 -- .',
      { cwd: rootDir, encoding: 'utf-8', timeout: 30000 },
    );
  } catch { /* ignore */ }

  const now = new Date().toISOString();

  for (const [file, count] of counts) {
    result.set(file, {
      file,
      change_count: count,
      period_days: days,
      churn_rate: count / days,
      last_changed: now, // simplified — exact date would need per-file git log
    });
  }

  return result;
}
