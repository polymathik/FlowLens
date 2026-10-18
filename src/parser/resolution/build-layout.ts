/**
 * Build layout of a package — where its compiled output lives and where its
 * sources live — so an import that lands in build output can be mapped back
 * to the source file the indexer actually knows (Map M0, D1).
 *
 *   packages/core/dist/index.js  ──outDir→rootDir──▶  packages/core/src/index.ts
 *   packages/core/dist/x.d.ts                          packages/core/src/x.ts
 *
 * The mapping is purely path-based: it works whether or not the build
 * output exists on disk. Output dirs are the tsconfig `outDir` /
 * `declarationDir` (following `extends`) plus the conventional
 * `dist|build|out|lib` (TS 5.5 `${configDir}` is supported; directories outside
 * the package are ignored); source roots are `rootDir`, the `include` roots,
 * `src`, `src/lib` and the package root.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readJsonc } from './jsonc.js';
import { resolveExtends } from './tsconfig.js';

export interface BuildLayout {
  pkgDir: string;
  /** Absolute build-output directories (never the package root itself). */
  outDirs: string[];
  /** Absolute source roots, most specific first. */
  srcRoots: string[];
}

interface RawTsconfig {
  extends?: string | string[];
  compilerOptions?: { outDir?: string; declarationDir?: string; rootDir?: string };
  include?: string[];
}

interface Found { outDirs: string[]; rootDirs: string[]; include: string[] }

const CONVENTIONAL_OUT = ['dist', 'build', 'out', 'lib'];
const TSCONFIG_NAMES = ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.lib.json'];

const layoutCache = new Map<string, BuildLayout>();
const packageDirCache = new Map<string, string | null>();

export function clearBuildLayoutCache(): void {
  layoutCache.clear();
  packageDirCache.clear();
}

/** Compiler options of one tsconfig, following `extends` (child wins; paths resolve against their declaring file). */
function readOptions(file: string, depth: number, out: Found, leafDir = dirname(file)): void {
  if (depth > 10) return;
  const raw = readJsonc<RawTsconfig>(file);
  if (!raw || typeof raw !== 'object') return;
  const dir = dirname(file);
  const opts = raw.compilerOptions ?? {};
  // TS 5.5 `${configDir}` = directory of the config that was handed to the compiler (the leaf).
  const at = (v: string) => resolve(dir, v.replace('${configDir}', leafDir));
  if (typeof opts.outDir === 'string') out.outDirs.push(at(opts.outDir));
  if (typeof opts.declarationDir === 'string') out.outDirs.push(at(opts.declarationDir));
  if (typeof opts.rootDir === 'string') out.rootDirs.push(at(opts.rootDir));
  if (Array.isArray(raw.include) && depth === 0) {
    for (const g of raw.include) if (typeof g === 'string') out.include.push(resolve(dir, globRoot(g)));
  }
  const parents = raw.extends === undefined ? [] : Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  for (const ext of parents) {
    const parent = resolveExtends(ext, dir);
    if (parent) readOptions(parent, depth + 1, out, leafDir);
  }
}

/** `src/**\/*.ts` → `src`; `*.ts` → `.` */
function globRoot(glob: string): string {
  const parts = glob.replace(/^\.\//, '').split('/');
  const fixed: string[] = [];
  for (const p of parts) {
    if (/[*?{[]/.test(p) || /\.\w+$/.test(p)) break;
    fixed.push(p);
  }
  return fixed.join('/') || '.';
}

function isDir(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

export function getBuildLayout(pkgDir: string): BuildLayout {
  const hit = layoutCache.get(pkgDir);
  if (hit) return hit;
  const found: Found = { outDirs: [], rootDirs: [], include: [] };
  for (const name of TSCONFIG_NAMES) {
    const file = join(pkgDir, name);
    if (existsSync(file)) readOptions(file, 0, found);
  }
  const outDirs = [...new Set([...found.outDirs, ...CONVENTIONAL_OUT.map((d) => join(pkgDir, d))])]
    .filter((d) => d !== pkgDir && d.startsWith(pkgDir + sep));
  const outSet = new Set(outDirs);
  const srcRoots = [...new Set([
    ...found.rootDirs, ...found.include,
    join(pkgDir, 'src'), join(pkgDir, 'src', 'lib'), pkgDir,
  ])].filter((d) => !outSet.has(d) && isDir(d));
  const layout = { pkgDir, outDirs, srcRoots };
  layoutCache.set(pkgDir, layout);
  return layout;
}

/** `index.d.ts`, `x.js`, `x.d.mts` → stem (`index`, `x`); `Foo.svelte` / `.css` / `.json` stay as written. */
export function stripBuiltExtension(rel: string): string {
  return rel.replace(/(\.d)?\.[mc]?[jt]sx?$/, '');
}

/** Is `abs` inside one of the layout's build-output directories? */
export function isBuildOutput(layout: BuildLayout, abs: string): boolean {
  return layout.outDirs.some((d) => abs === d || abs.startsWith(d + sep));
}

/**
 * Source-file candidates (absolute; extensionless for code so any of
 * `.ts/.tsx/.mts/.js…` matches) for a path inside build output. Empty when
 * `abs` is not under an output directory.
 */
export function builtToSourceCandidates(layout: BuildLayout, abs: string): string[] {
  const out: string[] = [];
  for (const outDir of layout.outDirs) {
    if (abs !== outDir && !abs.startsWith(outDir + sep)) continue;
    const rel = stripBuiltExtension(relative(outDir, abs).split(sep).join('/'));
    if (!rel || rel.startsWith('..')) continue;
    for (const root of layout.srcRoots) out.push(join(root, rel));
  }
  return [...new Set(out)];
}

/** Nearest ancestor directory (inside `root`) holding a package.json, or null. */
export function findPackageDir(abs: string, root: string): string | null {
  let dir = dirname(abs);
  const visited: string[] = [];
  let found: string | null = null;
  while (dir.startsWith(root) && dir.length >= root.length) {
    const cached = packageDirCache.get(dir);
    if (cached !== undefined) { found = cached; break; }
    visited.push(dir);
    if (existsSync(join(dir, 'package.json'))) { found = dir; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of visited) packageDirCache.set(d, found);
  return found;
}
