/**
 * Python module → project file resolution.
 *
 * `from .a.b import x` (relative, `level` leading dots) resolves against the
 * importing file's package; absolute `pkg.mod` resolves against the source
 * roots: the project root, `src/`, and the parent of the importing file's
 * top-level package (walking up through `__init__.py` directories).
 * A module that is not found is treated as external (stdlib / site-packages).
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { normalizeRelativePath } from '../../utils/paths.js';
import type { ModuleResolution } from './ts-module-resolver.js';

function isFile(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}

function probeModule(base: string, parts: string[]): string | null {
  const p = join(base, ...parts);
  if (parts.length > 0 && isFile(`${p}.py`)) return `${p}.py`;
  if (isFile(join(p, '__init__.py'))) return join(p, '__init__.py');
  return null;
}

function sourceRoots(fromAbs: string, root: string): string[] {
  const roots = [root, join(root, 'src')];
  let dir = dirname(fromAbs);
  while (dir.startsWith(root) && dir !== root && isFile(join(dir, '__init__.py'))) dir = dirname(dir);
  if (!roots.includes(dir)) roots.push(dir);
  return roots;
}

export function resolvePythonModule(
  module: string,
  level: number,
  fromFile: string,
  rootDir: string,
): ModuleResolution {
  if (!rootDir) return { file: null, external: level === 0 };
  const root = resolve(rootDir);
  const fromAbs = join(root, fromFile);
  const parts = module ? module.split('.') : [];
  let hit: string | null = null;
  if (level > 0) {
    let base = dirname(fromAbs);
    for (let i = 1; i < level; i++) base = dirname(base);
    hit = probeModule(base, parts);
    return { file: toRel(hit, root), external: false };
  }
  for (const r of sourceRoots(fromAbs, root)) {
    hit = probeModule(r, parts);
    if (hit) break;
  }
  return hit ? { file: toRel(hit, root), external: false } : { file: null, external: true };
}

function toRel(abs: string | null, root: string): string | null {
  if (!abs || !abs.startsWith(root + sep)) return null;
  return normalizeRelativePath(abs.slice(root.length + 1));
}
