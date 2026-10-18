/**
 * TS/JS module specifier → project file resolution.
 *
 * Order (mirrors TypeScript `moduleResolution: bundler/node16` closely enough
 * for code mapping):
 *   1. Relative / absolute specifiers against the importing file's directory.
 *   2. Node builtins (`node:fs`, `fs`, …) → external.
 *   3. tsconfig/jsconfig `paths` and `baseUrl` of the nearest config.
 *   4. Local workspace packages (npm/yarn/pnpm) → their source entry.
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

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];

export function clearModuleResolverCaches(): void {
  clearTsconfigCache();
  clearWorkspaceCache();
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
      const hit = toProjectPath(probe(candidate), root);
      if (hit) return { file: hit, external: false };
    }
  }

  const ws = resolveWorkspaceImport(bare, root);
  if (ws) return { file: ws, external: false };

  return { file: null, external: true };
}

function resolveWorkspaceImport(specifier: string, root: string): string | null {
  const packages = getWorkspacePackages(root);
  if (packages.size === 0) return null;
  let best: string | null = null;
  for (const name of packages.keys()) {
    if ((specifier === name || specifier.startsWith(name + '/')) && (!best || name.length > best.length)) {
      best = name;
    }
  }
  if (!best) return null;
  const pkg = packages.get(best)!;
  const subpath = specifier.slice(best.length + 1);
  for (const candidate of packageEntryCandidates(pkg, subpath)) {
    const hit = toProjectPath(probe(candidate), root);
    if (hit) return hit;
  }
  return null;
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
