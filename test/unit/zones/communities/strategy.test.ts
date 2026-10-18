import { describe, it, expect } from 'vitest';
import { buildHierarchy } from '../../../../src/analysis/hierarchy/index.js';
import { computeZones, hasZoning } from '../../../../src/analysis/zones/index.js';
import { ZONE_CONFIG_KEY, type ZoneOverrides, type ZoneSet } from '../../../../src/contracts/zones.js';
import { allFileIds, expectConsistent, shuffled } from '../helpers.js';
import {
  fileEntity, halcyonCorpus, importRelation, monorepo, synthProject, toHierarchy, zoneRun, assignmentOf, type Corpus,
} from './synth.js';

const leaves = (set: ZoneSet) => set.zones.filter((z) => z.childIds.length === 0 && z.source !== 'config');
describe('communities strategy', () => {
  it('is registered and does not fall back to folders', () => {
    expect(hasZoning('communities')).toBe(true);
    const { set } = zoneRun(synthProject({ clusters: 3, min: 6, max: 8, seed: 1 }));
    expect(set.mode).toBe('communities');
    expect(set.fallbackFrom).toBeUndefined();
  });

  it('puts every file in exactly one zone and keeps sizes in 5–40', () => {
    const corpus = synthProject({ clusters: 8, min: 10, max: 20, seed: 7, noise: 0.15, scatter: 0.3 });
    const { set, h } = zoneRun(corpus);
    expect(expectConsistent(set, allFileIds(h))).toEqual([]);
    const sizes = leaves(set).map((z) => z.stats.files);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(40);
    expect(set.zones.filter((z) => z.source === 'community').length).toBeGreaterThanOrEqual(6);
    expect(set.zones.find((z) => z.key === ZONE_CONFIG_KEY)?.fileIds.length).toBe(2); // package.json, tsconfig.json
  });

  it('recovers clear clusters: files of a cluster share a zone, with a high intra-zone ratio', () => {
    const corpus = synthProject({ clusters: 6, min: 12, max: 14, seed: 3, noise: 0.03 });
    const { assignment, set } = zoneRun(corpus);
    const topicOf = (p: string): string => p.split('/')[1];
    const byZone = new Map<string, Set<string>>();
    for (const [p, key] of Object.entries(assignment)) {
      if (p.startsWith('src/')) byZone.set(key, new Set([...(byZone.get(key) ?? []), topicOf(p)]));
    }
    const pure = [...byZone.values()].filter((t) => t.size === 1).length;
    expect(pure).toBeGreaterThanOrEqual(5);
    expect(set.quality!.intraRatio).toBeGreaterThan(0.85);
    expect(set.quality!.modularity).toBeGreaterThan(0.5);
  });

  it('splits zones above 40 files recursively into nested zones (coarse communities from an earlier run are kept as parents)', () => {
    // 2 dense groups of 54 files, each made of 3 sub-folders; an earlier run had one community per group
    const files: string[] = ['package.json'];
    const relations = [];
    let seed = 1;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const previous: Record<string, string> = {};
    for (let g = 0; g < 2; g++) {
      const group = Array.from({ length: 54 }, (_, i) => `src/g${g}/part${i % 3}/file${i}.ts`);
      files.push(...group);
      for (const f of group) previous[f] = `./g${g}`;
      group.forEach((f, i) => {
        relations.push(importRelation(f, group[(i % 3) + 3 * next(18)]), importRelation(f, group[(i % 3) + 3 * next(18)]), importRelation(f, group[next(54)]));
      });
    }
    const corpus = { entities: files.map(fileEntity), relations: relations.filter((r) => r.from !== r.to) };
    const { set, h } = zoneRun(corpus, previous);
    expect(expectConsistent(set, allFileIds(h))).toEqual([]);
    expect(Math.max(...leaves(set).map((z) => z.stats.files))).toBeLessThanOrEqual(40);
    const parents = set.zones.filter((z) => z.childIds.length > 0 && z.source === 'community');
    expect(parents.map((p) => p.key).sort()).toEqual(['./g0', './g1']);
    for (const parent of parents) {
      expect(parent.fileIds).toEqual([]); // files live in the leaves
      expect(parent.stats.files).toBe(54);
      expect(parent.childIds.length).toBeGreaterThanOrEqual(2);
    }
    for (const z of set.zones.filter((x) => x.parentId !== null)) {
      expect(z.key.startsWith(`${set.zones.find((x) => x.id === z.parentId)!.key}/`)).toBe(true); // nested keys: <parent>/<slug>
    }
  });

  it('splits a dense blob that no resolution separates (folder fallback), leaves stay within 5–40', () => {
    const files = Array.from({ length: 90 }, (_, i) => `src/blob/part${i % 4}/f${i}.ts`);
    const relations = [];
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j += 3) relations.push(importRelation(files[i], files[j]));
    const { set, h } = zoneRun({ entities: [...files.map(fileEntity), fileEntity('package.json')], relations });
    expect(expectConsistent(set, allFileIds(h))).toEqual([]);
    const sizes = leaves(set).map((z) => z.stats.files);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(40);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(5);
  });

  it('merges zones below 5 files into their strongest neighbour, keeps isolated ones', () => {
    const base = synthProject({ clusters: 3, min: 12, max: 14, seed: 5, noise: 0 });
    const topic = base.entities.find((e) => e.file.startsWith('src/billing/'))!.file;
    const satellites = ['src/billing/sat-a.ts', 'src/billing/sat-b.ts', 'src/billing/sat-c.ts'];
    const island = ['src/island/x.ts', 'src/island/y.ts', 'src/island/z.ts'];
    const corpus: Corpus = {
      entities: [...base.entities, ...[...satellites, ...island].map(fileEntity)],
      relations: [
        ...base.relations,
        importRelation(satellites[0], satellites[1]), importRelation(satellites[1], satellites[2]), importRelation(satellites[0], topic),
        importRelation(island[0], island[1]), importRelation(island[1], island[2]),
      ],
    };
    const { assignment } = zoneRun(corpus);
    expect(assignment[satellites[0]]).toBe(assignment[topic]); // joined the cluster they import
    expect(new Set(satellites.map((s) => assignment[s]))).toEqual(new Set([assignment[topic]]));
    const islandKey = assignment[island[0]];
    expect(new Set(island.map((s) => assignment[s]))).toEqual(new Set([islandKey])); // together, alone: the documented exception
    expect(Object.values(assignment).filter((k) => k === islandKey)).toHaveLength(3);
  });

  it('treats workspace packages as hard boundaries: wrapper zones named by package, no mixed communities', () => {
    const corpus = monorepo([
      { name: 'alpha', clusters: 4, min: 12, max: 14, seed: 1 },
      { name: 'beta', clusters: 1, min: 12, max: 14, seed: 2 },
    ]);
    const { set, h } = zoneRun(corpus);
    expect(expectConsistent(set, allFileIds(h))).toEqual([]);
    const alpha = set.zones.find((z) => z.key === '@t/alpha')!;
    expect(alpha.source).toBe('package');
    expect(alpha.childIds.length).toBeGreaterThanOrEqual(3);
    expect(alpha.nodeId).toBe('package:packages/alpha');
    const beta = set.zones.find((z) => z.key === '@t/beta')!; // small package: the package zone holds the files itself
    expect(beta.childIds).toEqual([]);
    expect(beta.fileIds.length).toBeGreaterThan(12);
    for (const z of leaves(set)) {
      const pkgs = new Set(z.fileIds.map((f) => f.split('/')[1]));
      expect(pkgs.size).toBe(1);
    }
    // community keys are `<package>/<slug>`
    for (const c of set.zones.filter((z) => z.source === 'community')) expect(c.key.startsWith('@t/alpha/')).toBe(true);
    expect(alpha.fileIds.sort()).toEqual(['file:packages/alpha/package.json', 'file:packages/alpha/tsconfig.json']); // manifests stay in the package zone
  });

  it('attaches tests to the community of the files they import, config to the Config zone', () => {
    const corpus = synthProject({ clusters: 4, min: 12, max: 14, seed: 4, noise: 0.02 });
    const { assignment, set } = zoneRun(corpus);
    for (const topic of ['auth', 'billing', 'search', 'render']) {
      const test = assignment[`test/${topic}.test.ts`];
      const imported = Object.entries(assignment).filter(([p]) => p.startsWith(`src/${topic}/`) || p.includes(`/${topic}-`)).map(([, k]) => k);
      expect(test).toBeDefined();
      expect(imported).toContain(test);
    }
    const cfg = set.zones.find((z) => z.key === ZONE_CONFIG_KEY)!;
    expect(cfg.source).toBe('config');
    expect(cfg.fileIds.sort()).toEqual(['file:package.json', 'file:tsconfig.json']);
  });

  it('is independent of the order of entities and relations', () => {
    const corpus = synthProject({ clusters: 7, min: 10, max: 18, seed: 13, noise: 0.2, scatter: 0.4 });
    const a = zoneRun(corpus).set;
    for (const seed of [1, 2, 3]) {
      const b = zoneRun({ ...corpus, entities: shuffled(corpus.entities, seed), relations: shuffled(corpus.relations, seed + 10) }).set;
      expect(b).toEqual(a);
    }
  });

  it('names zones from their folder prefix, else distinctive words; siblings never share a label', () => {
    const corpus = synthProject({ clusters: 6, min: 10, max: 14, seed: 8, noise: 0.05 });
    const { set } = zoneRun(corpus);
    const labels = set.zones.filter((z) => z.source === 'community').map((z) => z.label);
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
    expect(labels.some((l) => /^(auth|billing|search|render|storage|network)\b/.test(l))).toBe(true);
    expect(labels.every((l) => !/^\w+ \d+$/.test(l) || l.startsWith('misc'))).toBe(true);
    for (const z of set.zones.filter((x) => x.source === 'community')) {
      const slug = z.key.slice(z.key.lastIndexOf('/') + 1);
      expect(slug).toMatch(/^[a-z0-9._@~+-]+$/);
    }
  });

  it('disambiguates siblings that would get the same prefix with their next distinctive word, never a number first', () => {
    // two communities, both in the same folder
    const files = [...'abcdefghijkl'].map((c, i) => `src/core/${i < 6 ? 'parse' : 'render'}-${c}.ts`);
    const entities = [...files.map(fileEntity), fileEntity('package.json')];
    const relations = [];
    for (const group of [files.slice(0, 6), files.slice(6)]) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) relations.push(importRelation(group[i], group[j]));
    const { set } = zoneRun({ entities, relations });
    const labels = set.zones.filter((z) => z.source === 'community' || z.source === 'folder').map((z) => z.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.join(' ')).not.toMatch(/ 2\b/);
  });

  it('respects scopeId and returns an empty set for an unknown scope', () => {
    const corpus = monorepo([
      { name: 'alpha', clusters: 4, min: 12, max: 14, seed: 1 },
      { name: 'beta', clusters: 3, min: 12, max: 14, seed: 2 },
    ]);
    const { h, graph } = toHierarchy(corpus);
    const scoped = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, scopeId: 'package:packages/alpha' });
    const files = scoped.zones.flatMap((z) => z.fileIds);
    expect(files.length).toBeGreaterThan(40);
    expect(files.every((f) => f.startsWith('file:packages/alpha/'))).toBe(true);
    expect(scoped.zones.every((z) => z.source === 'config' || z.key.startsWith('@t/alpha/') || z.key === 'packages/alpha')).toBe(true);
    expect(computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, scopeId: 'folder:nope' }).zones).toEqual([]);
    const sub = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, scopeId: 'packages/beta/src' });
    expect(sub.zones.flatMap((z) => z.fileIds).every((f) => f.startsWith('file:packages/beta/src/'))).toBe(true);
  });

  it('works without a file graph (folder affinity only) and without any relation', () => {
    const corpus = synthProject({ clusters: 4, min: 12, max: 14, seed: 4 });
    const h = buildHierarchy({ projectName: 'P', entities: corpus.entities });
    const set = computeZones({ mode: 'communities', hierarchy: h });
    expect(expectConsistent(set, allFileIds(h))).toEqual([]);
    expect(set.zones.length).toBeGreaterThan(1);
  });

  it('reports quality and per-zone cohesion', () => {
    const { set } = zoneRun(synthProject({ clusters: 5, min: 12, max: 14, seed: 6, noise: 0.05 }));
    expect(set.quality).toBeDefined();
    expect(set.quality!.intraRatio).toBeGreaterThan(0);
    expect(set.quality!.intraRatio).toBeLessThanOrEqual(1);
    const withCohesion = set.zones.filter((z) => z.cohesion !== undefined);
    expect(withCohesion.length).toBeGreaterThan(3);
    for (const z of withCohesion) expect(z.cohesion!).toBeGreaterThanOrEqual(0);
  });
});

describe('communities and user overrides', () => {
  const corpus = synthProject({ clusters: 5, min: 12, max: 14, seed: 9, noise: 0.04 });

  it('keys, renames, colours, collapse, pins and merges keyed by stable key survive a re-run with an edit', () => {
    const first = zoneRun(corpus);
    const [a, b, c] = first.set.zones.filter((z) => z.source === 'community');
    const mover = c.fileIds.find((f) => f.startsWith('file:src/'))!;
    const overrides: ZoneOverrides = {
      version: 1,
      zones: {
        [`communities:${a.key}`]: { name: 'My auth', color: 3, collapsed: true },
        [`communities:${b.key}`]: { mergeInto: `communities:${c.key}` },
      },
      pins: { [mover.replace('file:', '')]: `communities:${a.key}` },
    };
    const run = (assignment: Record<string, string> | undefined, extra: Corpus) => {
      const { h, graph } = toHierarchy(extra);
      return computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, previousAssignment: assignment, overrides });
    };
    const edited: Corpus = {
      entities: [...corpus.entities, fileEntity('src/auth/newcomer.ts')],
      relations: [...corpus.relations, importRelation('src/auth/newcomer.ts', a.fileIds[0].replace('file:', ''))],
    };
    const second = run(first.assignment, edited);
    const za = second.zones.find((z) => z.key === a.key)!;
    expect(za.label).toBe('My auth');
    expect(za.colorIndex).toBe(3);
    expect(za.collapsed).toBe(true);
    expect(za.customized).toBe(true);
    expect(za.fileIds).toContain(mover); // the pin still wins
    expect(second.zones.find((z) => z.key === b.key)).toBeUndefined(); // merged away, still merged
    expect(second.zones.find((z) => z.key === c.key)!.fileIds.length).toBeGreaterThan(c.fileIds.length - 1);
  });

  it('a cold run after an edit can reshuffle keys; the warm run keeps them', () => {
    const first = zoneRun(corpus);
    const edited: Corpus = { entities: corpus.entities, relations: corpus.relations.slice(0, -6) };
    const warm = zoneRun(edited, first.assignment).assignment;
    const keys = (a: Record<string, string>) => new Set(Object.values(a));
    for (const k of keys(warm)) expect(keys(first.assignment).has(k)).toBe(true);
  });
});

describe('communities on the Halcyon export', () => {
  const halcyon = halcyonCorpus();
  it.skipIf(!halcyon)('groups halcyon-ai into logical zones of 5–40 files', () => {
    const { h, graph } = toHierarchy(halcyon!, 'halcyon');
    const set = computeZones({ mode: 'communities', hierarchy: h, fileGraph: graph, scopeId: 'packages/server' });
    const sizes = leaves(set).map((z) => z.stats.files);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(40);
    // each provider's own files stay together (the codex adapter files share one zone)
    const asg = assignmentOf(set, h);
    const codex = Object.entries(asg).filter(([p]) => p.includes('/adapters/codex/') && p.endsWith('.ts') && !p.includes('test'));
    expect(new Set(codex.map(([, k]) => k)).size).toBe(1);
    expect(set.quality!.intraRatio).toBeGreaterThan(0.6);
  });
});
