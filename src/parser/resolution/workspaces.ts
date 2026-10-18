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

export interface WorkspacePackage {
  name: string;
  /** Absolute package directory. */
  dir: string;
  /** Raw `exports` field. */
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
}

interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  exports?: unknown;
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
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
 * Candidate entry files (absolute, extension as written) for a workspace
 * package import. `subpath` is '' for the package root or e.g. 'utils'.
 */
export function packageEntryCandidates(pkg: WorkspacePackage, subpath: string): string[] {
  const key = subpath ? `./${subpath}` : '.';
  const out: string[] = [];
  const fromExports = exportTargets(pkg.exports, key);
  for (const t of fromExports) out.push(join(pkg.dir, t));
  if (!subpath) {
    for (const f of [pkg.types, pkg.module, pkg.main]) if (f) out.push(join(pkg.dir, f));
    out.push(join(pkg.dir, 'src', 'index'), join(pkg.dir, 'index'));
  } else {
    out.push(join(pkg.dir, 'src', subpath), join(pkg.dir, subpath));
  }
  // dist/ → src/ fallback (built output is usually not indexed)
  const withSrc = out.flatMap((p) => {
    const rel = relative(pkg.dir, p);
    const m = /^(dist|build|lib|out)\/(.*)$/.exec(rel);
    return m ? [p, join(pkg.dir, 'src', m[2])] : [p];
  });
  return [...new Set(withSrc)];
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

const CONDITION_ORDER = ['types', 'source', 'development', 'import', 'module', 'node', 'require', 'default'];

function conditionTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(conditionTargets);
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const ordered = [
    ...CONDITION_ORDER.filter((c) => c in obj),
    ...Object.keys(obj).filter((k) => !CONDITION_ORDER.includes(k)),
  ];
  return ordered.flatMap((c) => conditionTargets(obj[c]));
}
