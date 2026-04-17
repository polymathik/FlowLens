import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosticRunner } from '../../contracts/doctor.js';

/**
 * Compares each tracked file's mtime against its `last_indexed` timestamp
 * stored in `.flowlens/file_index.json`. Any file whose mtime is more than
 * 1s newer than its last_indexed is flagged. Deleted files also count as
 * stale. Hash comparison would be stricter but too slow for a health
 * check — it belongs in `flowlens index` itself.
 *
 * Performance note: for 10K files this stat loop is <50ms.
 */
export const fileIndexCurrentCheck: DiagnosticRunner = async ({
  flowlensDir,
  rootDir,
}) => {
  const base = {
    name: 'file-index-current',
    title: 'File index current',
  };
  const indexPath = join(flowlensDir, 'file_index.json');
  if (!existsSync(indexPath)) {
    return {
      ...base,
      status: 'warning',
      message: 'file_index.json missing',
      details: 'Run "flowlens index".',
    };
  }
  try {
    const content = await readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, { last_indexed?: string }>;
    const files = Object.keys(parsed);
    let staleCount = 0;
    for (const rel of files) {
      const full = join(rootDir, rel);
      if (!existsSync(full)) {
        staleCount++;
        continue;
      }
      const mtimeMs = statSync(full).mtimeMs;
      const indexedAt = parsed[rel]?.last_indexed;
      if (!indexedAt) {
        staleCount++;
        continue;
      }
      const indexedMs = Date.parse(indexedAt);
      if (Number.isNaN(indexedMs)) {
        staleCount++;
        continue;
      }
      // Allow 1s clock skew / filesystem-timestamp-granularity tolerance.
      if (mtimeMs > indexedMs + 1000) staleCount++;
    }
    if (staleCount === 0) {
      return {
        ...base,
        status: 'ok',
        message: `file index current (${files.length.toLocaleString()} files tracked)`,
      };
    }
    return {
      ...base,
      status: 'warning',
      message: `${staleCount} files changed since last index`,
      details: 'Run "flowlens index" to refresh.',
    };
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: `file_index.json invalid: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};
