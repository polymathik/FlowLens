/**
 * Test corpora for communities: synthetic projects (clear clusters, noise, tests, config), the Halcyon
 * export when present, and random one-file edits on either (add / remove edges, add / delete a file).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHierarchy, selectPackages } from '../../../../src/analysis/hierarchy/index.js';
import { buildFileGraph, computeZones } from '../../../../src/analysis/zones/index.js';
import type { Hierarchy, HierarchyEntity, PackageInfo } from '../../../../src/contracts/hierarchy.js';
import type { Relation } from '../../../../src/contracts/relations.js';
import type { ZoneSet, ZoningFileGraph } from '../../../../src/contracts/zones.js';

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the indexer hands the canvas: entities and relations (plus the workspace packages). */
export interface Corpus {
  entities: HierarchyEntity[];
  relations: Relation[];
  packages?: PackageInfo[];
}

const TOPICS = ['auth', 'billing', 'search', 'render', 'storage', 'network', 'parser', 'report', 'queue', 'mailer'];
const PARTS = ['service', 'store', 'model', 'view', 'cache', 'client', 'router', 'schema', 'worker', 'format', 'guard', 'index', 'loader', 'event'];

export interface SynthOptions {
  clusters: number;
  min: number;
  max: number;
  seed: number;
  /** Share of files with one import into another cluster. */
  noise?: number;
  /** Share of files that live in another cluster's folder (a messy repo: folders do not match the structure). */
  scatter?: number;
  /** Import edges per file inside the cluster, plus 0-1 (default 2). */
  degree?: number;
  prefix?: string;
  /** Directory the whole project lives in (a package dir), '' = repository root. */
  base?: string;
}

export const fileEntity = (path: string): HierarchyEntity => ({
  id: `f:${path}`, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path, language: 'typescript', metrics: { line_count: 10 },
});

let relationCounter = 0;
export const importRelation = (from: string, to: string): Relation => ({
  id: `r${relationCounter++}`, from: `f:${from}`, to: `f:${to}`, type: 'import', location: { file: from, line: 1, column: 0 }, weight: 1, confidence: 1,
});

export function synthProject(o: SynthOptions): Corpus {
  const rnd = rng(o.seed);
  const files: string[] = [`${o.base ? `${o.base}/` : ''}package.json`, `${o.base ? `${o.base}/` : ''}tsconfig.json`];
  const pairs = new Map<string, [string, string]>();
  const link = (a: string, b: string): void => {
    if (a !== b) pairs.set(`${a}\u0000${b}`, [a, b]);
  };
  const base = o.base ? `${o.base}/` : '';
  const prefix = `${base}${o.prefix ?? 'src'}`;
  const all: string[] = [];
  for (let c = 0; c < o.clusters; c++) {
    const topic = TOPICS[c % TOPICS.length] + (c >= TOPICS.length ? String(c) : '');
    const n = o.min + Math.floor(rnd() * (o.max - o.min + 1));
    const members: string[] = [];
    for (let i = 0; i < n; i++) {
      const home = rnd() < (o.scatter ?? 0) ? TOPICS[Math.floor(rnd() * o.clusters) % TOPICS.length] : topic;
      members.push(`${prefix}/${home}/${topic}-${PARTS[i % PARTS.length]}${i >= PARTS.length ? i : ''}.ts`);
    }
    files.push(...members);
    all.push(...members);
    members.forEach((f, i) => {
      for (let k = 0; k < (o.degree ?? 2) + Math.floor(rnd() * 2); k++) link(f, members[Math.floor(rnd() * members.length)]);
      if (i > 0) link(f, members[Math.floor(rnd() * i)]); // keeps each cluster connected
    });
    const test = `${base}test/${topic}.test.ts`;
    files.push(test);
    for (const t of members.slice(0, 2)) link(test, t);
  }
  for (const f of all) if (rnd() < (o.noise ?? 0.06)) link(f, all[Math.floor(rnd() * all.length)]);
  return { entities: files.map(fileEntity), relations: [...pairs.values()].map(([a, b]) => importRelation(a, b)) };
}

/** The Halcyon export (`entities.json`, `relations.json`, `workspace.json`) when the directory has it. */
export function halcyonCorpus(dir = process.env.M3_HALCYON_DIR ?? '/tmp/M3'): Corpus | null {
  if (!existsSync(join(dir, 'entities.json')) || !existsSync(join(dir, 'relations.json')) || !existsSync(join(dir, 'workspace.json'))) return null;
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as T;
  const ws = read<{ manifests: PackageInfo[]; workspace_globs: string[] }>('workspace.json');
  return { entities: read('entities.json'), relations: read('relations.json'), packages: selectPackages(ws.manifests, ws.workspace_globs) };
}

export function toHierarchy(c: Corpus, name = 'Synth'): { h: Hierarchy; graph: ZoningFileGraph } {
  const h = buildHierarchy({ projectName: name, entities: c.entities, packages: c.packages });
  return { h, graph: buildFileGraph(h, c.relations) };
}

/** Run the strategy; `assignment` maps every file path to its innermost community key (config zone excluded). */
export function zoneRun(c: Corpus, previous?: Record<string, string>, scopeId?: string): { set: ZoneSet; assignment: Record<string, string>; h: Hierarchy } {
  const { h, graph } = toHierarchy(c);
  const set = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, previousAssignment: previous, scopeId });
  return { set, assignment: assignmentOf(set, h), h };
}

export function assignmentOf(set: ZoneSet, h: Hierarchy): Record<string, string> {
  const byId = new Map(set.zones.map((z) => [z.id, z]));
  const out: Record<string, string> = {};
  for (const [fileId, zoneId] of Object.entries(set.zoneOfFile)) {
    if (byId.get(zoneId)!.source !== 'config') out[h.nodes.get(fileId)!.path] = byId.get(zoneId)!.key;
  }
  return out;
}

/** Share of the files present in both runs whose community key changed (strict: by key). */
export function changedByKey(before: Record<string, string>, after: Record<string, string>): number {
  const common = Object.keys(after).filter((p) => before[p] !== undefined);
  return common.length === 0 ? 0 : common.filter((p) => before[p] !== after[p]).length / common.length;
}

/** Share of files that moved when `after`'s communities are matched to `before`'s by largest overlap (key-agnostic). */
export function changedByOverlap(before: Record<string, string>, after: Record<string, string>): number {
  const common = Object.keys(after).filter((p) => before[p] !== undefined);
  if (common.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const p of common) counts.set(`${after[p]}\u0000${before[p]}`, (counts.get(`${after[p]}\u0000${before[p]}`) ?? 0) + 1);
  const mapped = new Map<string, string>();
  const taken = new Set<string>();
  for (const [k] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
    const [a, b] = k.split('\u0000');
    if (mapped.has(a) || taken.has(b)) continue;
    mapped.set(a, b);
    taken.add(b);
  }
  return common.filter((p) => mapped.get(after[p]) !== before[p]).length / common.length;
}

export type EditKind = 'add-edges' | 'remove-edges' | 'add-file' | 'delete-file';

const isCode = (path: string): boolean => /\.(ts|tsx|js|mjs|svelte)$/.test(path) && !/(^|\/)(test|tests|scripts)\//.test(path) && !/\.(test|spec|config)\./.test(path);

/** One random edit touching a single file. */
export function randomEdit(c: Corpus, rnd: () => number): { next: Corpus; kind: EditKind } {
  const code = c.entities.filter((e) => e.kind === 'file' && isCode(e.file)).map((e) => e.file);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const roll = rnd();
  const kind: EditKind = roll < 0.3 ? 'add-edges' : roll < 0.55 ? 'remove-edges' : roll < 0.8 ? 'add-file' : 'delete-file';
  const f = pick(code);
  const dir = f.slice(0, f.lastIndexOf('/'));
  const near = code.filter((x) => x.startsWith(dir) && x !== f);
  const fileOf = new Map(c.entities.map((e) => [e.id, e.file]));
  if (kind === 'add-edges') {
    const targets = Array.from({ length: 2 }, () => (rnd() < 0.7 && near.length > 0 ? pick(near) : pick(code))).filter((t) => t !== f);
    return { kind, next: { ...c, relations: [...c.relations, ...targets.map((t) => importRelation(f, t))] } };
  }
  if (kind === 'remove-edges') {
    const mine = c.relations.filter((r) => fileOf.get(r.from) === f || fileOf.get(r.to) === f);
    const drop = new Set(mine.slice(0, 1 + Math.floor(rnd() * 3)).map((r) => r.id));
    return { kind, next: { ...c, relations: c.relations.filter((r) => !drop.has(r.id)) } };
  }
  if (kind === 'add-file') {
    const name = `${dir}/added-${Math.floor(rnd() * 1e6)}.ts`;
    const pool = near.length > 0 ? near : code;
    return { kind, next: { ...c, entities: [...c.entities, fileEntity(name)], relations: [...c.relations, ...[pick(pool), pick(pool), pick(pool)].map((t) => importRelation(name, t))] } };
  }
  const gone = new Set(c.entities.filter((e) => e.file === f).map((e) => e.id));
  return { kind, next: { ...c, entities: c.entities.filter((e) => !gone.has(e.id)), relations: c.relations.filter((r) => !gone.has(r.from) && !gone.has(r.to)) } };
}

/** Several projects side by side as workspace packages `packages/<name>` (names `@t/<name>`). */
export function monorepo(parts: Array<{ name: string } & SynthOptions>): Corpus {
  const corpora = parts.map((p) => synthProject({ ...p, base: `packages/${p.name}` }));
  return {
    entities: corpora.flatMap((c) => c.entities),
    relations: corpora.flatMap((c) => c.relations),
    packages: parts.map((p) => ({ dir: `packages/${p.name}`, name: `@t/${p.name}`, manifest: 'package.json' })),
  };
}
