/**
 * TS/JS module specifier → project file resolution.
 *
 * Order (mirrors TypeScript `moduleResolution: bundler/node16` closely enough
 * for code mapping):
 *   1. Relative / absolute specifiers against the importing file's directory.
 *   2. Node builtins (`node:fs`, `fs`, …) → external.
 *   3. tsconfig/jsconfig `paths` and `baseUrl` of the nearest config.
 *   3b. `#subpath` imports declared by the nearest package.json (`"imports"`).
 *   4. Local workspace packages (npm/yarn/pnpm) → their *source* entry
 *      (build output `dist/…` is mapped back to `src/…`, see build-layout.ts).
 *   5. Anything else → external package.
 * ESM-style `.js/.jsx/.mjs/.cjs` specifiers map to `.ts/.tsx/.mts/.cts`
 * sources first, as TypeScript does.
 */
import { statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { normalizeRelativePath } from '../../utils/paths.js';
import { findNearestConfig, loadPathMapping, expandWithPaths, clearTsconfigCache } from './tsconfig.js';
import { getWorkspacePackages, packageEntryCandidates, clearWorkspaceCache } from './workspaces.js';
import { builtToSourceCandidates, clearBuildLayoutCache, findPackageDir, getBuildLayout } from './build-layout.js';
import { clearPackageImportsCache, resolvePackageImport } from './package-imports.js';

export interface ModuleResolution {
  /** Project-relative path of the resolved file, or null. */
  file: string | null;
  /** True when the specifier names something outside the project. */
  external: boolean;
}

const BUILTINS = new Set(builtinModules);

const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
};

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.svelte', '.vue'];

export function clearModuleResolverCaches(): void {
  clearTsconfigCache();
  clearWorkspaceCache();
  clearBuildLayoutCache();
  clearPackageImportsCache();
}

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..'
    || specifier.startsWith('/');
}

export function resolveModuleSpecifier(
  specifier: string,
  fromFile: string,
  rootDir: string,
): ModuleResolution {
  const relative = isRelativeSpecifier(specifier);
  if (!rootDir) return { file: null, external: !relative };
  const root = resolve(rootDir);

  if (relative) {
    // SvelteKit's `./$types` is written by `svelte-kit sync` (gitignored): generated, not a project file.
    if (/(^|\/)\$(types|houdini)$/.test(specifier)) return { file: null, external: true };
    const base = dirname(join(root, fromFile));
    return { file: toProjectPath(probe(resolve(base, specifier)), root), external: false };
  }

  const bare = specifier.split('?')[0];
  if (bare.startsWith('node:') || BUILTINS.has(bare) || BUILTINS.has(bare.split('/')[0])) {
    return { file: null, external: true };
  }

  const configFile = findNearestConfig(dirname(join(root, fromFile)), root);
  const mapping = configFile ? loadPathMapping(configFile) : null;
  if (mapping) {
    for (const candidate of expandWithPaths(bare, mapping)) {
      const hit = toProjectPath(probeSourceFirst(candidate, root), root);
      if (hit) return { file: hit, external: false };
    }
  }

  const sub = resolveSubpathImport(bare, fromFile, root);
  if (sub) return sub;

  const lib = resolveSvelteKitLib(bare, fromFile, root);
  if (lib) return lib;

  const ws = resolveWorkspaceImport(bare, root);
  if (ws.matched) return { file: ws.file, external: false };

  return { file: null, external: true };
}

/**
 * Node `#subpath` imports (package.json `imports`). A declared import that
 * names no existing file is unresolved (not external) so the count is honest
 * and the importer is re-resolved when the file appears.
 */
function resolveSubpathImport(bare: string, fromFile: string, root: string): ModuleResolution | null {
  const res = resolvePackageImport(bare, join(root, fromFile), root);
  if (!res) return null;
  for (const candidate of res.candidates) {
    const hit = toProjectPath(probe(candidate), root);
    if (hit) return { file: hit, external: false };
  }
  return { file: null, external: res.bareTarget && res.candidates.length === 0 };
}

/**
 * SvelteKit's `$lib` alias → `<package>/src/lib`. SvelteKit writes it into the
 * generated `.svelte-kit/tsconfig.json`, which is usually absent (gitignored,
 * created by `svelte-kit sync`), so it is built in.
 */
function resolveSvelteKitLib(bare: string, fromFile: string, root: string): ModuleResolution | null {
  if (bare !== '$lib' && !bare.startsWith('$lib/')) return null;
  const pkgDir = findPackageDir(join(root, fromFile), root);
  const libDir = pkgDir ? join(pkgDir, 'src', 'lib') : null;
  if (!libDir || !statSync(libDir, { throwIfNoEntry: false })?.isDirectory()) return { file: null, external: true };
  return { file: toProjectPath(probe(join(libDir, bare.slice(5))), root), external: false };
}

/**
 * A workspace package is part of the project: an import that names one but
 * finds no file is *unresolved* (so the indexer re-checks it when a file is
 * added), never "external".
 */
function resolveWorkspaceImport(specifier: string, root: string): { matched: boolean; file: string | null } {
  const packages = getWorkspacePackages(root);
  if (packages.size === 0) return { matched: false, file: null };
  let best: string | null = null;
  for (const name of packages.keys()) {
    if ((specifier === name || specifier.startsWith(name + '/')) && (!best || name.length > best.length)) {
      best = name;
    }
  }
  if (!best) return { matched: false, file: null };
  const pkg = packages.get(best)!;
  const subpath = specifier.slice(best.length + 1);
  for (const candidate of packageEntryCandidates(pkg, subpath)) {
    const hit = toProjectPath(probe(candidate), root);
    if (hit) return { matched: true, file: hit };
  }
  return { matched: true, file: null };
}

/**
 * Probe `abs`, but if it lies in a package's build output (`dist/…`) look for
 * the matching source file first (Map M0, D1). Path-based: the build output
 * does not have to exist.
 */
function probeSourceFirst(abs: string, root: string): string | null {
  const pkgDir = findPackageDir(abs, root);
  if (pkgDir) {
    for (const c of builtToSourceCandidates(getBuildLayout(pkgDir), abs)) {
      const hit = probe(c);
      if (hit) return hit;
    }
  }
  return probe(abs);
}

function isFile(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}

/** Probe an absolute path (with or without extension) for a source file. */
export function probe(abs: string): string | null {
  const ext = extname(abs);
  const mapped = JS_TO_TS[ext];
  if (mapped) {
    const stem = abs.slice(0, -ext.length);
    for (const m of mapped) if (isFile(stem + m)) return stem + m;
  }
  if (isFile(abs)) return abs;
  for (const e of PROBE_EXTENSIONS) if (isFile(abs + e)) return abs + e;
  for (const e of PROBE_EXTENSIONS) {
    const idx = join(abs, `index${e}`);
    if (isFile(idx)) return idx;
  }
  return null;
}

function toProjectPath(abs: string | null, root: string): string | null {
  if (!abs) return null;
  if (!abs.startsWith(root + sep)) return null;
  if (abs.includes(`${sep}node_modules${sep}`)) return null;
  return normalizeRelativePath(abs.slice(root.length + 1));
}
