import { execFileSync } from 'node:child_process';
import type { AgentChangedSource } from '../contracts/agent.js';
import { buildChangedFileFilter } from './file-filter.js';

/** Raw git working-tree changes (modified, staged, untracked, deleted). */
export function getGitChangedFiles(rootDir: string): string[] {
  const files = new Set<string>();
  const commands = [
    ['diff', '--name-only', '--diff-filter=ACMR'],
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    ['ls-files', '--others', '--exclude-standard'],
    ['diff', '--name-only', '--diff-filter=D'],
  ];
  for (const args of commands) {
    for (const file of runGit(rootDir, args)) files.add(file);
  }
  return [...files].filter(Boolean).sort();
}

/** Git changes filtered by config exclude, ignore files, and supported extensions. */
export async function getFilteredGitChangedFiles(rootDir: string): Promise<string[]> {
  const raw = getGitChangedFiles(rootDir);
  if (raw.length === 0) return [];
  const keep = await buildChangedFileFilter(rootDir);
  return raw.filter(keep);
}

export function getGitHead(rootDir: string): string | null {
  return runGit(rootDir, ['rev-parse', 'HEAD'])[0] ?? null;
}

export interface ResolvedChangedFiles {
  files: string[];
  source: AgentChangedSource;
}

/** Precedence: explicit `--changed`, then hook input, then (optionally) git. */
export async function resolveChangedFiles(options: {
  explicit: string[];
  hook: string[];
  rootDir: string;
  useGit: boolean;
}): Promise<ResolvedChangedFiles> {
  if (options.explicit.length > 0) return { files: dedupe(options.explicit), source: 'argument' };
  if (options.hook.length > 0) return { files: dedupe(options.hook), source: 'hook' };
  if (options.useGit) {
    const gitFiles = await getFilteredGitChangedFiles(options.rootDir);
    if (gitFiles.length > 0) return { files: gitFiles, source: 'git' };
  }
  return { files: [], source: 'none' };
}

function dedupe(files: string[]): string[] {
  return [...new Set(files.map((file) => file.replaceAll('\\', '/')))].sort();
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
