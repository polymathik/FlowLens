/**
 * Read a project's graph manifest and copy `last_indexed` into the registry.
 *
 * The manifest (`.flowlens/manifest.json`, written by the indexer — Lane A)
 * is the source of truth. Until it exists we fall back to the mtime of
 * `file_index.json`, which the indexer rewrites at the end of every run.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphManifest } from '../contracts/manifest.js';
import type { ProjectRecord, ProjectRegistry } from '../contracts/projects.js';

export function readManifest(root: string): GraphManifest | null {
  const p = join(root, '.flowlens', 'manifest.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as GraphManifest;
  } catch {
    return null;
  }
}

export function lastIndexedFromDisk(root: string): string | null {
  const manifest = readManifest(root);
  if (manifest?.finished_at) return manifest.finished_at;
  try {
    return statSync(join(root, '.flowlens', 'file_index.json')).mtime.toISOString();
  } catch {
    return null;
  }
}

/** Touch `last_indexed` when the on-disk value is newer. Returns the value. */
export async function syncLastIndexed(
  registry: ProjectRegistry,
  rec: ProjectRecord,
): Promise<string | null> {
  const onDisk = lastIndexedFromDisk(rec.root);
  if (onDisk && onDisk !== rec.last_indexed) {
    try {
      await registry.touch(rec.id, { last_indexed: onDisk });
    } catch {
      return rec.last_indexed; // removed concurrently
    }
    return onDisk;
  }
  return rec.last_indexed;
}
