import { execFileSync } from 'node:child_process';

export function getGitChangedFiles(rootDir: string): string[] {
  const files = new Set<string>();
  for (const file of runGit(rootDir, ['diff', '--name-only', '--diff-filter=ACMR'])) {
    files.add(file);
  }
  for (const file of runGit(rootDir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR'])) {
    files.add(file);
  }
  for (const file of runGit(rootDir, ['ls-files', '--others', '--exclude-standard'])) {
    files.add(file);
  }
  for (const file of runGit(rootDir, ['diff', '--name-only', '--diff-filter=D'])) {
    files.add(file);
  }
  return [...files].filter(Boolean).sort();
}

function runGit(rootDir: string, args: string[]): string[] {
  try {
    const output = execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
