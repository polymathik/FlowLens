/**
 * Node.js subpath imports — the `"imports"` field of package.json (`#lib/*`).
 *
 *   "imports": { "#lib": "./src/lib/index.js", "#lib/*": "./src/lib/*" }
 *   import { api } from '#lib/api.js'   →   <pkg>/src/lib/api.ts
 *
 * Semantics follow https://nodejs.org/api/packages.html#subpath-imports:
 *  - the nearest package.json above the importing file is the scope;
 *  - an exact key wins, otherwise the pattern key (one `*`) with the longest
 *    prefix; every `*` of the target is replaced by the matched text;
 *  - a target is a string, an array of fallbacks, a conditions object or
 *    `null` (blocked); conditions are ranked like workspace `exports`
 *    (source › development › svelte › types › import › … › default);
 *  - a relative target ("./…") is a file of this package, a bare target
 *    ("lodash") points at another package (external).
 * Like workspace exports, targets inside build output (`dist/…`) are mapped
 * back to source by path (build-layout.ts), so the result does not depend on
 * whether the build exists.
 *
 * Returns `null` when the specifier is not a `#` import or the scope declares
 * no `imports` (Nuxt `#app`, Vite virtual ids …): the caller keeps its default.
 * A `#` import the scope declares but that names no existing file is
 * *unresolved* (never silently external), so the unresolved count stays honest.
 */
import { join, sep } from 'node:path';
import { readJsonc } from './jsonc.js';
import { builtToSourceCandidates, findPackageDir, getBuildLayout, isBuildOutput } from './build-layout.js';
import { conditionTargets } from './workspaces.js';

export interface PackageImportResult {
  /** Absolute candidate files (source first), tried in order by the caller. */
  candidates: string[];
  /** The map pointed outside the project (another package) for at least one target. */
  bareTarget: boolean;
}

type ImportsMap = Record<string, unknown>;

const importsCache = new Map<string, ImportsMap | null>();

export function clearPackageImportsCache(): void {
  importsCache.clear();
}

function importsOf(pkgDir: string): ImportsMap | null {
  const hit = importsCache.get(pkgDir);
  if (hit !== undefined) return hit;
  const pkg = readJsonc<{ imports?: unknown }>(join(pkgDir, 'package.json'));
  const map = pkg && pkg.imports && typeof pkg.imports === 'object' && !Array.isArray(pkg.imports)
    ? (pkg.imports as ImportsMap) : null;
  importsCache.set(pkgDir, map);
  return map;
}

/** Best matching key of `map` for `specifier`, with the text `*` matched. */
function matchKey(map: ImportsMap, specifier: string): { key: string; middle: string } | null {
  if (specifier in map) return { key: specifier, middle: '' };
  let best: { key: string; middle: string } | null = null;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star < 0 || key.indexOf('*', star + 1) >= 0) continue;
    const pre = key.slice(0, star);
    const post = key.slice(star + 1);
    if (specifier.length < key.length - 1 || !specifier.startsWith(pre) || !specifier.endsWith(post)) continue;
    if (!best || pre.length > best.key.indexOf('*') || (pre.length === best.key.indexOf('*') && key.length > best.key.length)) {
      best = { key, middle: specifier.slice(pre.length, specifier.length - post.length) };
    }
  }
  return best;
}

/**
 * @param fromAbs - absolute path of the importing file
 * @param root - absolute project root (the lookup never leaves it)
 */
export function resolvePackageImport(specifier: string, fromAbs: string, root: string): PackageImportResult | null {
  if (!specifier.startsWith('#')) return null;
  const pkgDir = findPackageDir(fromAbs, root);
  const map = pkgDir ? importsOf(pkgDir) : null;
  if (!pkgDir || !map) return null;

  const hit = matchKey(map, specifier);
  if (!hit) return { candidates: [], bareTarget: false };

  const layout = getBuildLayout(pkgDir);
  const sources: string[] = [];
  const built: string[] = [];
  let bareTarget = false;
  for (const raw of conditionTargets(map[hit.key])) {
    const target = raw.replaceAll('*', hit.middle);
    if (!target.startsWith('./')) { bareTarget = true; continue; }
    const abs = join(pkgDir, target);
    if (!abs.startsWith(pkgDir + sep)) continue; // `../x` escapes the package
    if (isBuildOutput(layout, abs)) {
      sources.push(...builtToSourceCandidates(layout, abs));
      built.push(abs);
    } else {
      sources.push(abs);
    }
  }
  return { candidates: [...new Set([...sources, ...built])], bareTarget };
}
