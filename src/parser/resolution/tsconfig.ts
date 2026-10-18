/**
 * tsconfig / jsconfig path-mapping loader.
 *
 * Implements the subset of TypeScript's module resolution configuration that
 * affects which project file an import names:
 *   - `compilerOptions.baseUrl` (non-relative specifiers resolve against it)
 *   - `compilerOptions.paths` (pattern → substitutions, at most one `*`)
 *   - `extends` (string or array, relative path or package in node_modules),
 *     later configs overriding earlier ones; `paths` are resolved relative to
 *     `baseUrl` when set, otherwise relative to the config that declares them.
 * The nearest tsconfig.json/jsconfig.json above a file applies to it.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonc } from './jsonc.js';

export interface PathMapping {
  /** Absolute directory non-relative specifiers resolve against (baseUrl), if any. */
  baseUrl: string | null;
  /** Absolute directory `paths` substitutions are relative to. */
  pathsBase: string;
  paths: Array<{ pattern: string; targets: string[] }>;
}

interface RawConfig {
  extends?: string | string[];
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
}

const configCache = new Map<string, PathMapping | null>();
const nearestCache = new Map<string, string | null>();

export function clearTsconfigCache(): void {
  configCache.clear();
  nearestCache.clear();
}

/** Nearest tsconfig.json / jsconfig.json at or above `dir`, stopping at `rootDir`. */
export function findNearestConfig(dir: string, rootDir: string): string | null {
  const cached = nearestCache.get(dir);
  if (cached !== undefined) return cached;
  let found: string | null = null;
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) { found = candidate; break; }
  }
  if (!found) {
    const parent = dirname(dir);
    const insideRoot = dir !== rootDir && parent !== dir && parent.startsWith(rootDir);
    found = insideRoot ? findNearestConfig(parent, rootDir) : null;
  }
  nearestCache.set(dir, found);
  return found;
}

/** Load the effective path mapping of a tsconfig file (following `extends`). */
export function loadPathMapping(configFile: string): PathMapping | null {
  if (configCache.has(configFile)) return configCache.get(configFile)!;
  configCache.set(configFile, null); // cycle guard
  const mapping = buildMapping(configFile, 0);
  configCache.set(configFile, mapping);
  return mapping;
}

function buildMapping(configFile: string, depth: number): PathMapping | null {
  if (depth > 10) return null;
  const raw = readJsonc<RawConfig>(configFile);
  if (!raw || typeof raw !== 'object') return null;
  const configDir = dirname(configFile);

  let inherited: PathMapping | null = null;
  const parents = raw.extends === undefined ? [] : Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  for (const ext of parents) {
    const parentFile = resolveExtends(ext, configDir);
    if (!parentFile) continue;
    const parentMapping = buildMapping(parentFile, depth + 1);
    if (parentMapping) inherited = mergeMappings(inherited, parentMapping);
  }

  const opts = raw.compilerOptions ?? {};
  const own: Partial<PathMapping> = {};
  if (typeof opts.baseUrl === 'string') own.baseUrl = resolve(configDir, opts.baseUrl);
  if (opts.paths && typeof opts.paths === 'object') {
    own.paths = Object.entries(opts.paths)
      .filter(([, t]) => Array.isArray(t))
      .map(([pattern, targets]) => ({ pattern, targets: targets.filter((t) => typeof t === 'string') }));
    own.pathsBase = own.baseUrl ?? inherited?.baseUrl ?? configDir;
  }

  const baseUrl = own.baseUrl ?? inherited?.baseUrl ?? null;
  if (!own.paths && !inherited && !baseUrl) return null;
  return {
    baseUrl,
    paths: own.paths ?? inherited?.paths ?? [],
    pathsBase: own.paths ? own.pathsBase! : (inherited?.pathsBase ?? baseUrl ?? configDir),
  };
}

function mergeMappings(a: PathMapping | null, b: PathMapping): PathMapping {
  if (!a) return b;
  return {
    baseUrl: b.baseUrl ?? a.baseUrl,
    paths: b.paths.length > 0 ? b.paths : a.paths,
    pathsBase: b.paths.length > 0 ? b.pathsBase : a.pathsBase,
  };
}

function resolveExtends(ext: string, configDir: string): string | null {
  const candidates: string[] = [];
  if (ext.startsWith('.') || ext.startsWith('/')) {
    const abs = resolve(configDir, ext);
    candidates.push(abs, `${abs}.json`, join(abs, 'tsconfig.json'));
  } else {
    // Package config, e.g. "@tsconfig/node20/tsconfig.json" — look in node_modules upward.
    let dir = configDir;
    for (let i = 0; i < 20; i++) {
      const abs = join(dir, 'node_modules', ext);
      candidates.push(abs, `${abs}.json`, join(abs, 'tsconfig.json'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find((c) => existsSync(c) && c.endsWith('.json')) ?? null;
}

/**
 * Expand a non-relative specifier through `paths` (then `baseUrl`) into
 * absolute candidate paths without extensions applied. Longest-prefix
 * pattern wins, as in TypeScript.
 */
export function expandWithPaths(specifier: string, mapping: PathMapping): string[] {
  let best: { pattern: string; targets: string[]; star: string } | null = null;
  for (const { pattern, targets } of mapping.paths) {
    const starIdx = pattern.indexOf('*');
    if (starIdx < 0) {
      if (pattern === specifier) { best = { pattern, targets, star: '' }; break; }
      continue;
    }
    const prefix = pattern.slice(0, starIdx);
    const suffix = pattern.slice(starIdx + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)
      && specifier.length >= prefix.length + suffix.length) {
      if (!best || prefix.length > best.pattern.indexOf('*')) {
        best = { pattern, targets, star: specifier.slice(prefix.length, specifier.length - suffix.length) };
      }
    }
  }
  const out: string[] = [];
  if (best) {
    for (const t of best.targets) out.push(resolve(mapping.pathsBase, t.replace('*', best.star)));
  }
  if (mapping.baseUrl) out.push(resolve(mapping.baseUrl, specifier));
  return out;
}
