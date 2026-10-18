/** Builders for zoning tests: hierarchies from path lists, fixture trees and a seeded shuffle. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildHierarchy, selectPackages } from '../../../src/analysis/hierarchy/index.js';
import { parseWorkspaceGlobs } from '../../../src/analysis/hierarchy/packages.js';
import type { Hierarchy, HierarchyEntity, PackageInfo } from '../../../src/contracts/hierarchy.js';
import type { Zone, ZoneSet } from '../../../src/contracts/zones.js';

export const fileEntity = (path: string, extra: Partial<HierarchyEntity> = {}): HierarchyEntity => ({
  id: `f:${path}`, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path, language: 'typescript',
  metrics: { line_count: 10 }, ...extra,
});

export const symbolEntity = (path: string, name: string, quality = 80): HierarchyEntity => ({
  id: `s:${path}#${name}`, kind: 'function', name, qualified_name: `${path}#${name}`, file: path,
  location: { line_start: 1, line_end: 5 }, metrics: { line_count: 5, quality_score: quality, churn_rate: 2, hotspot_score: 3 },
});

export interface Tree {
  h: Hierarchy;
  entities: HierarchyEntity[];
  packages: PackageInfo[];
}

/** Hierarchy from repo-relative file paths; `packages` are `[dir, name]` pairs. */
export function treeOf(paths: string[], packages: Array<[string, string]> = [], extra: HierarchyEntity[] = [], name = 'Proj'): Tree {
  const entities = [...paths.map((p) => fileEntity(p)), ...extra];
  const pk = packages.map(([dir, n]) => ({ dir, name: n, manifest: 'package.json' }));
  return { h: buildHierarchy({ projectName: name, entities, packages: pk }), entities, packages: pk };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (e === 'node_modules' || e === 'dist') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** A fixture directory as a hierarchy, with packages found the way the explorer finds them. */
export function treeOfDir(root: string): Tree {
  const files = walk(root).map((p) => relative(root, p).replace(/\\/g, '/'));
  const manifests: PackageInfo[] = files
    .filter((f) => f.endsWith('package.json'))
    .map((f) => ({
      dir: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '',
      name: (JSON.parse(readFileSync(join(root, f), 'utf-8')) as { name?: string }).name ?? '',
      manifest: 'package.json',
    }));
  let globs: string[] = [];
  try {
    globs = parseWorkspaceGlobs(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf-8'));
  } catch { /* no workspace file */ }
  const packages = selectPackages(manifests, globs);
  const entities = files.map((p) => fileEntity(p));
  return { h: buildHierarchy({ projectName: 'Fixture', entities, packages }), entities, packages };
}

/** Deterministic Fisher-Yates (mulberry32) so shuffles are reproducible. */
export function shuffled<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const byKey = (zs: ZoneSet, key: string): Zone => {
  const z = zs.zones.find((x) => x.key === key);
  if (!z) throw new Error(`no zone with key ${key}; have ${zs.zones.map((x) => x.key).join(', ')}`);
  return z;
};

/** `label (files)` for the roots, `  label (files)` per nesting level below. */
export function outline(zs: ZoneSet): string[] {
  const lines: string[] = [];
  const byId = new Map(zs.zones.map((z) => [z.id, z]));
  const visit = (id: string, depth: number): void => {
    const z = byId.get(id)!;
    lines.push(`${'  '.repeat(depth)}${z.label} (${z.stats.files})`);
    z.childIds.forEach((c) => visit(c, depth + 1));
  };
  zs.rootIds.forEach((id) => visit(id, 0));
  return lines;
}

/** Invariants every ZoneSet must satisfy against the hierarchy files it covers. */
export function expectConsistent(zs: ZoneSet, fileIds: string[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const byId = new Map(zs.zones.map((z) => [z.id, z]));
  for (const z of zs.zones) {
    for (const f of z.fileIds) {
      if (seen.has(f)) problems.push(`${f} in ${seen.get(f)} and ${z.id}`);
      seen.set(f, z.id);
      if (zs.zoneOfFile[f] !== z.id) problems.push(`zoneOfFile[${f}] wrong`);
    }
    const kids = z.childIds.map((c) => byId.get(c));
    if (kids.some((k) => !k || k.parentId !== z.id)) problems.push(`children of ${z.id} inconsistent`);
    const total = z.fileIds.length + kids.reduce((n, k) => n + (k?.stats.files ?? 0), 0);
    if (z.stats.files !== total) problems.push(`stats.files of ${z.id}: ${z.stats.files} != ${total}`);
  }
  for (const f of fileIds) if (!seen.has(f)) problems.push(`${f} in no zone`);
  if (seen.size !== fileIds.length) problems.push(`zones cover ${seen.size} files, expected ${fileIds.length}`);
  return problems;
}

export const allFileIds = (h: Hierarchy): string[] => [...h.byFile.values()].sort();
