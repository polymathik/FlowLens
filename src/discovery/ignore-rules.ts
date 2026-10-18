import ignore from 'ignore';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export function buildIgnoreFilter(patterns: string[]): (path: string) => boolean {
  const ig = ignore().add(patterns);
  return (path: string) => ig.ignores(path);
}

/**
 * Rebase one pattern of a nested `.gitignore` in `relDir` onto the project
 * root (git semantics): a pattern with no slash except a trailing one
 * matches at any depth below its directory (`relDir/**\/pat`); any other
 * pattern is anchored to the directory (`relDir/pat`).
 */
export function rebaseNestedPattern(line: string, relDir: string): string {
  const negated = line.startsWith('!');
  const body = negated ? line.slice(1) : line;
  const core = body.endsWith('/') ? body.slice(0, -1) : body;
  const rebased = core.includes('/')
    ? `${relDir}/${body.replace(/^\//, '')}`
    : `${relDir}/**/${body}`;
  return negated ? `!${rebased}` : rebased;
}

/** Parse lines from an ignore file, filtering comments and blanks. */
function parseIgnoreLines(content: string): string[] {
  return content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
}

/**
 * Load ignore patterns from `.flowlensignore` (root only) and `.gitignore`
 * (root + nested directories, matching standard git behavior).
 *
 * Nested `.gitignore` patterns are prefixed with their relative directory
 * so they apply correctly when matched against root-relative paths.
 */
export async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  const patterns: string[] = [];

  // .flowlensignore — root only, highest precedence
  const flowlensIgnore = join(rootDir, '.flowlensignore');
  if (existsSync(flowlensIgnore)) {
    const content = await readFile(flowlensIgnore, 'utf-8');
    patterns.push(...parseIgnoreLines(content));
  }

  // .gitignore — root + nested
  await collectGitignorePatterns(rootDir, rootDir, patterns);

  return patterns;
}

/**
 * Recursively collect .gitignore patterns from a directory tree.
 * Patterns from nested .gitignore files are prefixed with their
 * relative path so they work with root-relative path matching.
 */
async function collectGitignorePatterns(
  dir: string,
  rootDir: string,
  patterns: string[],
): Promise<void> {
  const gitignorePath = join(dir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, 'utf-8');
    const lines = parseIgnoreLines(content);
    const relDir = relative(rootDir, dir);

    if (relDir === '') {
      // Root .gitignore — patterns apply as-is
      patterns.push(...lines);
    } else {
      // Nested .gitignore — rebase patterns onto the root
      const base = relDir.split('\\').join('/');
      for (const line of lines) patterns.push(rebaseNestedPattern(line.trimEnd(), base));
    }
  }

  // Recurse into subdirectories (skip obvious non-project dirs)
  const SKIP_DIRS = new Set(['node_modules', '.git', '.flowlens', 'dist', 'build']);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
      await collectGitignorePatterns(join(dir, entry.name), rootDir, patterns);
    }
  }
}
