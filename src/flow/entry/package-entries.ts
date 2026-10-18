/**
 * Entry points declared in package.json: `bin` (executables), `scripts`
 * that run a source file (`tsx scripts/seed.ts`), and `main` / `module` /
 * `exports['.']` (the public API of a library).
 *
 * Manifests usually point at BUILT files (`dist/cli.js`); those are mapped
 * back to the indexed source (`src/cli.ts`) and the evidence says so.
 */
import type { Entity } from '../../contracts/entities.js';
import type { EntryPoint } from '../../contracts/flow.js';
import type { FlowGraph } from '../graph.js';
import { allPackageJsons, type PackageJsonInfo } from './package-info.js';
import { makeEntry, type DetectContext } from './types.js';

const BUILD_DIRS = ['dist', 'build', 'lib', 'out'];
const EXT_SWAP: Array<[RegExp, string[]]> = [
  [/\.js$/, ['.ts', '.tsx', '.js', '.jsx']], [/\.mjs$/, ['.mts', '.ts', '.mjs']], [/\.cjs$/, ['.cts', '.ts', '.cjs']], [/\.jsx$/, ['.tsx', '.jsx']],
];

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
const joinDir = (dir: string, rel: string): string => norm(dir ? `${dir}/${rel}` : rel);

/** Indexed source file for a manifest path, or null. `mapped` tells whether it was not the literal file. */
export function sourceForManifestPath(graph: FlowGraph, pkgDir: string, rel: string): { file: string; mapped: boolean } | null {
  const full = joinDir(pkgDir, norm(rel));
  if (graph.fileEntity.has(full)) return { file: full, mapped: false };
  const tail = norm(rel).split('/');
  const candidates: string[] = [];
  if (BUILD_DIRS.includes(tail[0])) candidates.push(['src', ...tail.slice(1)].join('/'), tail.slice(1).join('/'));
  candidates.push(norm(rel));
  for (const base of candidates) {
    const swaps = EXT_SWAP.find(([re]) => re.test(base));
    for (const ext of swaps ? swaps[1] : ['']) {
      const f = joinDir(pkgDir, swaps ? base.replace(swaps[0], ext) : base);
      if (graph.fileEntity.has(f)) return { file: f, mapped: true };
    }
  }
  return null;
}

function binEntries(pkg: PackageJsonInfo): Array<[string, string]> {
  const bin = pkg.json.bin;
  const pkgName = typeof pkg.json.name === 'string' ? pkg.json.name.replace(/^@[^/]+\//, '') : pkg.dir.split('/').pop() || 'bin';
  if (typeof bin === 'string') return [[pkgName, bin]];
  if (bin && typeof bin === 'object') return Object.entries(bin as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string');
  return [];
}

const RUNNER = /\b(?:node|tsx|ts-node|bun(?:\s+run)?|deno\s+run|vite-node|babel-node|nodemon|esno|jiti)\b(?:\s+-{1,2}[\w-]+(?:[ =]\S+)?)*\s+((?:\.\/)?[\w@./-]+\.(?:[cm]?[jt]sx?))/;

function scriptEntries(pkg: PackageJsonInfo): Array<[string, string]> {
  const scripts = pkg.json.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  const out: Array<[string, string]> = [];
  for (const [name, cmd] of Object.entries(scripts as Record<string, unknown>)) {
    const m = typeof cmd === 'string' ? cmd.match(RUNNER) : null;
    if (m) out.push([name, m[1]]);
  }
  return out;
}

function apiEntry(pkg: PackageJsonInfo): string | null {
  const exp = pkg.json.exports;
  const dot = exp && typeof exp === 'object' ? (exp as Record<string, unknown>)['.'] ?? exp : exp;
  const fromExports = (v: unknown): string | null => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') for (const k of ['import', 'default', 'require', 'types']) { const r = fromExports((v as Record<string, unknown>)[k]); if (r) return r; }
    return null;
  };
  const main = fromExports(dot) ?? (typeof pkg.json.module === 'string' ? pkg.json.module : null) ?? (typeof pkg.json.main === 'string' ? pkg.json.main : null);
  return main && !main.endsWith('.json') ? main : null;
}

/** Files re-exported (`export … from`) by a barrel, up to two levels. */
function reexported(graph: FlowGraph, file: string): string[] {
  const seen = new Set([file]);
  let frontier = [file];
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = [];
    for (const f of frontier) {
      const id = graph.fileEntity.get(f)?.id;
      for (const r of id ? graph.edgesFrom(id, 'import') : []) {
        const t = graph.byId.get(r.to);
        if (r.meta?.reexport && t && !seen.has(t.file)) { seen.add(t.file); next.push(t.file); }
      }
    }
    frontier = next;
  }
  return [...seen];
}

const API_KINDS = new Set(['function', 'class', 'component']);
const MAX_API_PER_PACKAGE = 30;

export function detectPackageEntries(ctx: DetectContext): EntryPoint[] {
  const { graph } = ctx;
  const out: EntryPoint[] = [];
  for (const pkg of allPackageJsons(ctx)) {
    for (const [name, rel] of binEntries(pkg)) {
      const hit = sourceForManifestPath(graph, pkg.dir, rel);
      const entity = hit && graph.fileEntity.get(hit.file);
      if (!hit || !entity) continue;
      out.push(makeEntry({
        entity, file: pkg.file, line: 1, kind: 'bin', label: `bin: ${name}`, confidence: hit.mapped ? 0.85 : 0.95,
        evidence: `package.json bin '${name}' → ${rel}${hit.mapped ? ` (built output; traced from source ${hit.file})` : ''}`,
      }));
    }
    for (const [name, rel] of scriptEntries(pkg)) {
      const hit = sourceForManifestPath(graph, pkg.dir, rel);
      const entity = hit && graph.fileEntity.get(hit.file);
      if (!hit || !entity) continue;
      out.push(makeEntry({
        entity, file: pkg.file, line: 1, kind: 'main', label: `script: ${name}`, confidence: 0.8,
        evidence: `package.json script '${name}' runs ${rel}`,
      }));
    }
    const apiRel = apiEntry(pkg);
    const api = apiRel ? sourceForManifestPath(graph, pkg.dir, apiRel) : null;
    if (!api) continue;
    const symbols: Entity[] = [];
    for (const f of reexported(graph, api.file)) {
      for (const e of graph.byFile.get(f) ?? []) {
        if (API_KINDS.has(e.kind) && e.visibility === 'public' && e.qualified_name === `${f}/${e.name}`) symbols.push(e);
      }
    }
    symbols.sort((a, b) => a.file.localeCompare(b.file) || a.location.line_start - b.location.line_start);
    for (const e of symbols.slice(0, MAX_API_PER_PACKAGE)) {
      out.push(makeEntry({
        entity: e, kind: 'export_api', label: `api: ${e.name}${e.kind === 'class' ? '' : '()'}`, confidence: 0.5,
        evidence: `public export of ${pkg.json.name ?? pkg.dir} (package.json main → ${apiRel}${api.mapped ? `, source ${api.file}` : ''})`,
      }));
    }
  }
  return out;
}
