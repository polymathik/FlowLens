/**
 * Shared path helpers for module granularity and scope filtering.
 *
 * A "module" is a directory (matching the indexer's `module` entities, whose
 * `file` is the directory path). Root-level files belong to module '.'.
 */

import type { Entity } from '../contracts/entities.js';

/**
 * Directory of a repo-relative path ('.' for root files). Same results as
 * `path.posix.dirname` on repo-relative paths, without importing `node:path`
 * so this module can also be bundled into the canvas (Map v2 shares it).
 */
export function dirnameOf(file: string): string {
  const p = file.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i).replace(/\/+$/, '') || '/';
}

/**
 * Directory module of a repo-relative file path ('.' for root files).
 *
 * This is the single definition of "module" for Health AND the Map: the
 * Map's folder node holding a file has exactly this path (the Map only
 * collapses single-child chains of folders for display).
 */
export function moduleOfFile(file: string): string {
  return dirnameOf(file);
}

/** Module of an entity: a module entity is its own module; others use their file's directory. */
export function moduleOfEntity(entity: Pick<Entity, 'kind' | 'file'>): string {
  return entity.kind === 'module' ? entity.file : moduleOfFile(entity.file);
}

/** Normalise a user-supplied scope: forward slashes, no leading './', no trailing '/'. */
export function normalizeScope(scope: string | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const s = scope.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return s === '' || s === '.' ? undefined : s;
}

/**
 * Path-prefix scope test on segment boundaries: scope 'src/canvas' matches
 * 'src/canvas' and 'src/canvas/x.ts' but not 'src/canvas2/x.ts'.
 */
export function isInScope(path: string, scope: string | undefined): boolean {
  const s = normalizeScope(scope);
  if (!s) return true;
  return path === s || path.startsWith(s + '/');
}
