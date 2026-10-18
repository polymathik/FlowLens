/**
 * Which paths history reports: exactly the files today's map can show — a
 * supported source/config extension, no dot-directory or dot-file, not
 * matched by `.flowlensignore`, the `.gitignore` files or `config.exclude`.
 * Reuses the indexer's own matcher and pattern loader, so history cannot
 * drift from discovery.
 */
import { extname } from 'node:path';
import type { FlowLensConfig } from '../contracts/config.js';
import { buildIgnoreFilter, loadIgnorePatterns } from '../discovery/ignore-rules.js';
import { hashContent } from '../utils/hash.js';
import { getSupportedExtensions } from '../utils/paths.js';

export interface HistoryFileFilter {
  accepts(path: string): boolean;
  /** Not inside a dot-directory and not ignored (any extension): files the resolver may need, such as `go.mod`. */
  unignored(path: string): boolean;
  /** Fingerprint of patterns + extensions; stored in the caches so a rule change invalidates them. */
  key: string;
  patterns: string[];
  extensions: string[];
}

export function createFileFilter(patterns: string[], extensions: string[]): HistoryFileFilter {
  const ext = new Set(extensions);
  const ignored = buildIgnoreFilter(patterns);
  const unignored = (path: string): boolean =>
    !path.split('/').some((seg) => seg.startsWith('.')) && !ignored(path); // fast-glob runs with dot:false
  return {
    accepts: (path) => ext.has(extname(path)) && unignored(path),
    unignored,
    key: hashContent(JSON.stringify([patterns, [...extensions].sort()])).slice(0, 16),
    patterns,
    extensions,
  };
}

/** Build the filter for a project root with its current config. */
export async function loadFileFilter(rootDir: string, config: FlowLensConfig): Promise<HistoryFileFilter> {
  const patterns = [...(await loadIgnorePatterns(rootDir)), ...config.exclude];
  return createFileFilter(patterns, getSupportedExtensions(config.languages));
}
