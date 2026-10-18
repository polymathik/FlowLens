/**
 * Filters candidate changed files the same way the indexer discovers files:
 * `.flowlensignore` + `.gitignore` patterns, config `exclude`, and the
 * enabled-language extension set. Always drops `.flowlens/` and `.claude/`
 * (graph data, snapshots, hook settings) so the guard never re-indexes them.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FlowLensConfig } from '../contracts/config.js';
import { buildIgnoreFilter, loadIgnorePatterns } from '../discovery/ignore-rules.js';
import { getSupportedExtensions } from '../utils/paths.js';

const ALWAYS_EXCLUDED = ['.flowlens/**', '.claude/**', '.git/**', 'node_modules/**'];

export type ChangedFileFilter = (file: string) => boolean;

export async function buildChangedFileFilter(rootDir: string): Promise<ChangedFileFilter> {
  const config = await readConfig(rootDir);
  let ignorePatterns: string[] = [];
  try {
    ignorePatterns = await loadIgnorePatterns(rootDir);
  } catch {
    ignorePatterns = [];
  }
  const isIgnored = buildIgnoreFilter([...ALWAYS_EXCLUDED, ...ignorePatterns, ...(config?.exclude ?? [])]);
  const extensions = supportedExtensions(config?.languages ?? {});
  return (file: string) => {
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('../')) return false;
    if (!extensions.has(extname(normalized))) return false;
    return !isIgnored(normalized);
  };
}

/** Mirrors the indexer: a language absent from `config.languages` is enabled. */
export function supportedExtensions(languages: Record<string, boolean>): Set<string> {
  return new Set(getSupportedExtensions(languages));
}

async function readConfig(rootDir: string): Promise<Partial<FlowLensConfig> | null> {
  const path = join(rootDir, '.flowlens', 'config.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Partial<FlowLensConfig>;
  } catch {
    return null;
  }
}
