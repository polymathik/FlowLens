import ignore from 'ignore';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function buildIgnoreFilter(patterns: string[]): (path: string) => boolean {
  const ig = ignore().add(patterns);
  return (path: string) => ig.ignores(path);
}

export async function loadIgnorePatterns(rootDir: string): Promise<string[]> {
  const patterns: string[] = [];

  const flowlensIgnore = join(rootDir, '.flowlensignore');
  if (existsSync(flowlensIgnore)) {
    const content = await readFile(flowlensIgnore, 'utf-8');
    patterns.push(...content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  }

  const gitignore = join(rootDir, '.gitignore');
  if (existsSync(gitignore)) {
    const content = await readFile(gitignore, 'utf-8');
    patterns.push(...content.split('\n').filter(l => l.trim() && !l.startsWith('#')));
  }

  return patterns;
}
