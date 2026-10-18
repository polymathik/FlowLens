import { describe, it, expect } from 'vitest';
import { buildHierarchy } from '../../../src/analysis/hierarchy/index.js';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { buildPortals } from '../../../src/canvas/utils/portals';
import type { HierarchyEntity } from '../../../src/contracts/hierarchy.js';
import type { Relation, RelationType } from '../../../src/contracts/relations.js';

const file = (path: string): HierarchyEntity => ({ id: `f:${path}`, kind: 'file', name: path.split('/').pop()!, qualified_name: path, file: path });
const fn = (path: string, name: string, kind: HierarchyEntity['kind'] = 'function', scope = name): HierarchyEntity => ({
  id: `s:${path}/${scope}`, kind, name, qualified_name: `${path}/${scope}`, file: path, location: { line_start: 1, line_end: 2 },
});
let n = 0;
const rel = (from: string, to: string, type: RelationType = 'import'): Relation => ({
  id: `r${++n}`, from, to, type, location: { file: 'x', line: 1, column: 0 }, weight: 1, confidence: 1,
});
const OPTS = { showLockfiles: false };

// packages/core/src/{adapter.ts(Adapter), index.ts(barrel)}, packages/server/src/{a.ts, b.ts, adapters/codex.ts}, apps/web/src/app.ts
const entities: HierarchyEntity[] = [
  file('packages/core/src/adapter.ts'), fn('packages/core/src/adapter.ts', 'Adapter', 'class'), fn('packages/core/src/adapter.ts', 'parse', 'method', 'Adapter.parse'),
  file('packages/core/src/index.ts'),
  file('packages/server/src/a.ts'), fn('packages/server/src/a.ts', 'runA'),
  file('packages/server/src/b.ts'), fn('packages/server/src/b.ts', 'runB'),
  file('packages/server/src/adapters/codex.ts'), fn('packages/server/src/adapters/codex.ts', 'Codex', 'class'),
  file('apps/web/src/app.ts'), fn('apps/web/src/app.ts', 'main'),
  file('package.json'), file('pnpm-lock.yaml'),
];
const packages = [
  { dir: 'packages/core', name: '@h/core' }, { dir: 'packages/server', name: '@h/server' }, { dir: 'apps/web', name: '@h/web' },
];
const h = buildHierarchy({ projectName: 'Halcyon', entities, packages });
const E = (path: string, name?: string) => (name ? `s:${path}/${name}` : `f:${path}`);

const relations: Relation[] = [
  rel(E('packages/server/src/a.ts'), E('packages/core/src/adapter.ts')), // import
  rel(E('packages/server/src/b.ts'), E('packages/core/src/adapter.ts')),
  rel(E('packages/server/src/adapters/codex.ts'), E('packages/core/src/adapter.ts')),
  rel(E('packages/server/src/a.ts', 'runA'), E('packages/core/src/adapter.ts', 'Adapter'), 'call'),
  rel(E('packages/server/src/a.ts', 'runA'), E('packages/core/src/adapter.ts', 'Adapter.parse'), 'call'),
  rel(E('apps/web/src/app.ts', 'main'), E('packages/core/src/adapter.ts', 'Adapter'), 'call'),
  rel(E('packages/server/src/a.ts'), E('packages/server/src/b.ts')),
  rel(E('packages/server/src/b.ts', 'runB'), E('packages/server/src/a.ts', 'runA'), 'call'),
  rel(E('packages/core/src/index.ts'), E('packages/core/src/adapter.ts'), 'import'),
  rel(E('packages/core/src/adapter.ts', 'Adapter'), E('packages/core/src/adapter.ts', 'Adapter.parse'), 'contain'),
  rel(E('packages/core/src/adapter.ts', 'Adapter.parse'), E('packages/core/src/adapter.ts', 'Adapter'), 'call'),
];

const sum = (a: { edges: number; portalIn: number; portalOut: number; internal: number; hidden: number }) =>
  a.edges + a.portalIn + a.portalOut + a.internal + a.hidden;

describe('computeMapView', () => {
  it('root shows the top-level containers and aggregates links between them with exact counts', () => {
    const v = computeMapView(h, relations, [], OPTS);
    expect(v.nodeIds).toEqual(['folder:apps', 'folder:packages', 'config:.']);
    expect(v.portals).toEqual([]);
    const link = v.links.find((l) => l.source === 'folder:packages' && l.target === 'folder:packages');
    expect(link).toBeUndefined(); // server -> core is inside "packages": internal
    expect(v.accounting.considered).toBe(10); // 11 minus the contain relation
    expect(v.accounting.edges + v.accounting.internal).toBe(10);
    const web = v.links.find((l) => l.source === 'folder:apps' && l.target === 'folder:packages')!;
    expect(web.count).toBe(1);
    expect(v.accounting.internal).toBe(9);
  });

  it('inside packages: server -> core links are shown as edges, no portals needed', () => {
    const v = computeMapView(h, relations, ['folder:packages'], OPTS);
    expect(v.nodeIds).toEqual(['package:packages/core', 'package:packages/server']);
    const l = v.links.find((x) => x.source === 'package:packages/server' && x.target === 'package:packages/core')!;
    expect(l.count).toBe(5);
    expect(l.typeCounts).toEqual({ import: 3, call: 2 });
    // apps/web -> core crosses the container: an incoming portal, not a dropped link.
    expect(v.portals.map((p) => [p.id, p.count])).toEqual([['portal:in:file:apps/web/src/app.ts', 1]]);
    expect(v.accounting.portalIn).toBe(1);
  });

  it('a file view keeps incoming links as portals with the exact total (nothing dropped)', () => {
    const adapter = 'file:packages/core/src/adapter.ts';
    const path = ['folder:packages', 'package:packages/core', 'folder:packages/core/src', adapter];
    const v = computeMapView(h, relations, path, OPTS);
    // symbols of adapter.ts: Adapter (parse is a member of Adapter) + scope node for the file's own imports.
    expect(v.nodeIds).toEqual(['s:packages/core/src/adapter.ts/Adapter', `scope:${adapter}`]);
    const inTotal = v.portals.filter((p) => p.direction === 'in').reduce((s, p) => s + p.count, 0);
    // every relation whose target is inside adapter.ts and whose source is outside: 3 imports from server files, 2 calls (runA), 1 call (main), 1 import from index.ts
    expect(inTotal).toBe(7);
    expect(v.accounting.portalIn).toBe(7);
    expect(v.accounting.considered).toBe(sum(v.accounting));
    // the internal Adapter.parse -> Adapter call is internal; contain is excluded
    expect(v.accounting.internal).toBe(1);
    expect(v.portals.every((p) => p.links.reduce((s, l) => s + l.count, 0) === p.count)).toBe(true);
  });

  it('is direction-aware: outgoing relations produce out portals', () => {
    const v = computeMapView(h, relations, ['folder:packages', 'package:packages/server', 'folder:packages/server/src'], OPTS);
    const out = v.portals.filter((p) => p.direction === 'out');
    expect(out.map((p) => p.targetId)).toEqual(['file:packages/core/src/adapter.ts']);
    expect(out[0].count).toBe(5);
    expect(out[0].typeCounts).toEqual({ import: 3, call: 2 });
    expect(v.portals.filter((p) => p.direction === 'in')).toEqual([]);
    expect(v.accounting.considered).toBe(sum(v.accounting));
  });

  it('leaf symbols show themselves with portals for callers and callees', () => {
    const run = 's:packages/server/src/a.ts/runA';
    const v = computeMapView(h, relations, ['folder:packages', 'package:packages/server', 'folder:packages/server/src', 'file:packages/server/src/a.ts', run], OPTS);
    expect(v.leaf).toBe(true);
    expect(v.nodeIds).toEqual([run]);
    expect(v.portals.find((p) => p.direction === 'in')!.count).toBe(1); // runB calls runA
    expect(v.portals.find((p) => p.direction === 'out')!.count).toBe(2); // Adapter, Adapter.parse
  });

  it('files without symbols are visible and carry their own relations as a leaf', () => {
    const v = computeMapView(h, relations, ['folder:packages', 'package:packages/core', 'folder:packages/core/src', 'file:packages/core/src/index.ts'], OPTS);
    expect(v.leaf).toBe(true);
    expect(v.portals.map((p) => [p.direction, p.count])).toEqual([['out', 1]]);
  });

  it('hides lockfiles unless asked', () => {
    expect(computeMapView(h, [], ['config:.'], OPTS).nodeIds).toEqual(['file:package.json']);
    expect(computeMapView(h, [], ['config:.'], { showLockfiles: true }).nodeIds).toEqual(['file:package.json', 'file:pnpm-lock.yaml']);
  });

  it('falls back to the project when the drill path no longer exists', () => {
    expect(computeMapView(h, [], ['folder:gone'], OPTS).containerId).toBe('project');
  });
});

describe('portal roll-up', () => {
  it('rolls up to coarser containers until at most `cap` portals remain, without losing relations', () => {
    const many: HierarchyEntity[] = [file('core/x.ts'), fn('core/x.ts', 'X')];
    const hits = [];
    const rels: Relation[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(file(`app/m${i % 3}/f${i}.ts`), fn(`app/m${i % 3}/f${i}.ts`, 'f'));
      rels.push(rel(`s:app/m${i % 3}/f${i}.ts/f`, 's:core/x.ts/X', 'call'));
    }
    const hh = buildHierarchy({ projectName: 'P', entities: many });
    const v = computeMapView(hh, rels, ['folder:core', 'file:core/x.ts'], { showLockfiles: false, portalCap: 5 });
    expect(v.portals.length).toBeLessThanOrEqual(5);
    expect(v.portals.reduce((s, p) => s + p.count, 0)).toBe(30);
    expect(v.portals.map((p) => p.targetId).sort()).toEqual(['folder:app/m0', 'folder:app/m1', 'folder:app/m2']);
    // with a generous cap the same relations stay at file granularity
    expect(computeMapView(hh, rels, ['folder:core', 'file:core/x.ts'], { showLockfiles: false, portalCap: 50 }).portals).toHaveLength(30);
    expect(buildPortals(hh, [], 5)).toEqual([]);
  });
});
