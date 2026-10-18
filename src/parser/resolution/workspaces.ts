/**
 * npm / yarn / pnpm workspace discovery.
 *
 * Maps each local workspace package name to its directory and entry
 * points so that `import { x } from '@acme/core'` inside a monorepo
 * resolves to the package's *source* file instead of being treated as an
 * external dependency.
 *
 * Sources: root `package.json` `workspaces` (array or `{ packages }`) and
 * `pnpm-workspace.yaml` `packages:` list. Globs support `dir/*`, `dir/**`
 * and literal directories; negations (`!x`) are honoured.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readJsonc } from './jsonc.js';
import { builtToSourceCandidates, getBuildLayout, isBuildOutput } from './build-layout.js';

export interface WorkspacePackage {
  name: string;
  /** Absolute package directory. */
  dir: string;
  /** Raw `exports` field. */
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  /** Non-standard `source` entry (Parcel / Microbundle convention): points at the real source. */
  source?: string;
  /** `svelte` entry of Svelte component libraries. */
  svelte?: string;
}

interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  source?: string;
  svelte?: string;
}

const cache = new Map<string, Map<string, WorkspacePackage>>();

export function clearWorkspaceCache(): void {
  cache.clear();
}

export function getWorkspacePackages(rootDir: string): Map<string, WorkspacePackage> {
  const hit = cache.get(rootDir);
  if (hit) return hit;
  const patterns = [...readNpmWorkspaces(rootDir), ...readPnpmWorkspaces(rootDir)];
  const packages = new Map<string, WorkspacePackage>();
  const include = patterns.filter((p) => !p.startsWith('!'));
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1));
  const excludedDirs = new Set(exclude.flatMap((p) => expandGlob(rootDir, p)));
  for (const pattern of include) {
    for (const dir of expandGlob(rootDir, pattern)) {
      if (excludedDirs.has(dir)) continue;
      const pkg = readJsonc<PackageJson>(join(dir, 'package.json'));
      if (!pkg?.name) continue;
      packages.set(pkg.name, {
        name: pkg.name,
        dir,
        exports: pkg.exports,
        main: pkg.main,
        module: pkg.module,
        types: pkg.types ?? pkg.typings,
        source: typeof pkg.source === 'string' ? pkg.source : undefined,
        svelte: typeof pkg.svelte === 'string' ? pkg.svelte : undefined,
      });
    }
  }
  cache.set(rootDir, packages);
  return packages;
}

function readNpmWorkspaces(rootDir: string): string[] {
  const pkg = readJsonc<PackageJson>(join(rootDir, 'package.json'));
  const ws = pkg?.workspaces;
  if (Array.isArray(ws)) return ws.filter((x) => typeof x === 'string');
  if (ws && Array.isArray(ws.packages)) return ws.packages.filter((x) => typeof x === 'string');
  return [];
}

/** Minimal reader for the `packages:` list of pnpm-workspace.yaml. */
function readPnpmWorkspaces(rootDir: string): string[] {
  const file = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(file)) return [];
  const out: string[] = [];
  let inPackages = false;
  for (const rawLine of readFileSync(file, 'utf-8').split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const m = /^\s+-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line);
      if (m) out.push(m[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return out;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

/** Expand a workspace glob into absolute directories that exist. */
function expandGlob(rootDir: string, pattern: string): string[] {
  const parts = pattern.replace(/^\.\//, '').replace(/\/$/, '').split('/');
  let dirs = [rootDir];
  for (const part of parts) {
    const next: string[] = [];
    for (const d of dirs) {
      if (part === '**') next.push(d, ...allSubdirs(d));
      else if (part.includes('*')) {
        const re = new RegExp('^' + part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        next.push(...listDirs(d).filter((n) => re.test(n)).map((n) => join(d, n)));
      } else if (existsSync(join(d, part))) next.push(join(d, part));
    }
    dirs = next;
  }
  return dirs.filter((d) => relative(rootDir, d) !== '' || pattern === '.');
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function allSubdirs(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  return listDirs(dir).flatMap((n) => [join(dir, n), ...allSubdirs(join(dir, n), depth + 1)]);
}

/**
 * Candidate entry files (absolute) for a workspace package import, **source
 * first** (Map M0, D1). `subpath` is '' for the package root or e.g. 'utils'.
 *
 * Order:
 *   1. targets that are already source, and the source file every build-output
 *      target maps back to (`dist/x.js` → `src/x.ts`, via tsconfig
 *      `outDir`/`rootDir`; see build-layout.ts) — in export-condition priority;
 *   2. conventional `src/<subpath>` / `<subpath>` locations;
 *   3. the build-output files themselves (only useful when they are indexed,
 *      e.g. a package that has no sources in the repo).
 * No candidate requires the build output to exist.
 */
export function packageEntryCandidates(pkg: WorkspacePackage, subpath: string): string[] {
  const key = subpath ? `./${subpath}` : '.';
  const targets: string[] = exportTargets(pkg.exports, key).map((t) => join(pkg.dir, t));
  if (!subpath) {
    for (const f of [pkg.source, pkg.svelte, pkg.types, pkg.module, pkg.main]) if (f) targets.push(join(pkg.dir, f));
  }
  const layout = getBuildLayout(pkg.dir);
  const sources: string[] = [];
  const built: string[] = [];
  for (const t of targets) {
    if (isBuildOutput(layout, t)) {
      sources.push(...builtToSourceCandidates(layout, t));
      built.push(t);
    } else {
      sources.push(t);
    }
  }
  const conventional = subpath
    ? [join(pkg.dir, 'src', subpath), join(pkg.dir, subpath)]
    : [join(pkg.dir, 'src', 'index'), join(pkg.dir, 'index')];
  return [...new Set([...sources, ...conventional, ...built])];
}

/** Collect string targets for `key` from an `exports` field (conditions in priority order). */
function exportTargets(exportsField: unknown, key: string): string[] {
  if (exportsField === undefined || exportsField === null) return [];
  if (typeof exportsField === 'string') return key === '.' ? [exportsField] : [];
  if (Array.isArray(exportsField)) return exportsField.flatMap((e) => exportTargets(e, key));
  if (typeof exportsField !== 'object') return [];
  const obj = exportsField as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.some((k) => k.startsWith('.'))) {
    if (key in obj) return conditionTargets(obj[key]);
    for (const k of keys) {
      const star = k.indexOf('*');
      if (star < 0) continue;
      const pre = k.slice(0, star);
      const post = k.slice(star + 1);
      if (key.startsWith(pre) && key.endsWith(post)) {
        const middle = key.slice(pre.length, key.length - post.length);
        return conditionTargets(obj[k]).map((t) => t.replace('*', middle));
      }
    }
    return [];
  }
  return key === '.' ? conditionTargets(obj) : [];
}

/**
 * Export conditions in priority order. `source` / `development` (and
 * scoped variants such as `@acme/source`) come first because they point at
 * the real source tree; `types` usually names a `.d.ts` in build output.
 * Condition order inside `exports` is otherwise significant to Node, but for
 * code *mapping* we want the source, not the runtime entry.
 */
const CONDITION_ORDER = ['source', 'development', 'svelte', 'types', 'import', 'module', 'node', 'require', 'default'];
const SOURCE_CONDITION = /(^|[/:@-])(source|src|typescript|ts)$/;

function conditionRank(c: string): number {
  if (SOURCE_CONDITION.test(c) && !CONDITION_ORDER.includes(c)) return -1;
  const i = CONDITION_ORDER.indexOf(c);
  return i < 0 ? CONDITION_ORDER.length : i;
}

export function conditionTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(conditionTargets);
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const ordered = Object.keys(obj)
    .map((k, i) => ({ k, i, r: conditionRank(k) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.k);
  return ordered.flatMap((c) => conditionTargets(obj[c]));
}
