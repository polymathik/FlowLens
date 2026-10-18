import { describe, it, expect } from 'vitest';
import { computeZones, hasZoning } from '../../../src/analysis/zones/index.js';
import { buildLayerMap } from '../../../src/analysis/architecture-validator.js';
import { firstFileLayerIndex } from '../../../src/analysis/layer-match.js';
import type { ArchitectureConfig, ArchitectureLayer } from '../../../src/contracts/architecture.js';
import { ZONE_UNASSIGNED_KEY, type ZoneOverrides } from '../../../src/contracts/zones.js';
import { allFileIds, byKey, expectConsistent, fileEntity, shuffled, symbolEntity, treeOf } from './helpers.js';
import { buildHierarchy } from '../../../src/analysis/hierarchy/index.js';

const PATHS = [
  'routes/users.ts', 'routes/admin.ts', 'services/user-service.ts', 'data/user-repo.ts',
  'src/shared/util.ts', 'README.md', 'package.json',
];
const LAYERS: ArchitectureLayer[] = [
  { name: 'Routes', include: { patterns: ['routes/**'] }, may_only_access: ['Services'] },
  { name: 'Services', include: { patterns: ['services/**'] }, may_only_access: ['Data'], must_not_access: ['Routes'] },
  { name: 'Data', include: { patterns: ['data/**'] } },
];
const ov = (zones: ZoneOverrides['zones'] = {}, pins: ZoneOverrides['pins'] = {}): ZoneOverrides => ({ version: 1, zones, pins });
const run = (layers: ArchitectureLayer[] = LAYERS, paths = PATHS, extra: Partial<Parameters<typeof computeZones>[0]> = {}) => {
  const { h } = treeOf(paths);
  return { h, zs: computeZones({ mode: 'layers', hierarchy: h, layers, ...extra }) };
};

describe('layers mode', () => {
  it('is registered and never falls back when layers exist', () => {
    expect(hasZoning('layers')).toBe(true);
    expect(run().zs.fallbackFrom).toBeUndefined();
  });

  it('one zone per layer in DECLARATION order (not alphabetical), Unassigned last, every file once', () => {
    const { h, zs } = run();
    expect(zs.mode).toBe('layers');
    expect(zs.rootIds).toEqual(['zone:layers:Routes', 'zone:layers:Services', 'zone:layers:Data', `zone:layers:${ZONE_UNASSIGNED_KEY}`]);
    expect(byKey(zs, 'Routes').fileIds).toEqual(['file:routes/admin.ts', 'file:routes/users.ts']);
    expect(byKey(zs, 'Routes').source).toBe('layer');
    expect(byKey(zs, ZONE_UNASSIGNED_KEY).fileIds).toEqual(['file:package.json', 'file:README.md', 'file:src/shared/util.ts']);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('Unassigned is muted (config source) and collapsed by default; layers are not', () => {
    const { zs } = run();
    const un = byKey(zs, ZONE_UNASSIGNED_KEY);
    expect(un.label).toBe('Unassigned');
    expect(un.source).toBe('config');
    expect(un.collapsed).toBe(true);
    expect(byKey(zs, 'Routes').collapsed).toBe(false);
  });

  it('no Unassigned zone when every file is covered', () => {
    const { zs } = run([{ name: 'All', include: { patterns: ['**'] } }]);
    expect(zs.zones.map((z) => z.key)).toEqual(['All']);
  });

  it('the first layer wins when patterns overlap; the order of declaration is the precedence', () => {
    const wide: ArchitectureLayer = { name: 'Everything', include: { patterns: ['**/*.ts'] } };
    const a = run([wide, ...LAYERS]).zs;
    expect(byKey(a, 'Everything').fileIds).toHaveLength(5);
    expect(a.zones.find((z) => z.key === 'Routes')).toBeUndefined(); // emptied layers are pruned
    const b = run([...LAYERS, wide]).zs;
    expect(byKey(b, 'Routes').fileIds).toHaveLength(2);
    expect(byKey(b, 'Everything').fileIds).toEqual(['file:src/shared/util.ts']);
  });

  it('include.files claims exact paths; include.entities claims a file by a symbol it holds', () => {
    const paths = ['a/x.ts', 'a/y.ts', 'b/z.ts'];
    const entities = [symbolEntity('a/y.ts', 'Special'), symbolEntity('a/y.ts', 'Other'), symbolEntity('b/z.ts', 'Plain')];
    const h = buildHierarchy({ projectName: 'P', entities: [...paths.map((p) => fileEntity(p)), ...entities] });
    const layers: ArchitectureLayer[] = [
      { name: 'Special', include: { entities: ['Special'] } },
      { name: 'Pinned', include: { files: ['b/z.ts'] } },
      { name: 'A', include: { patterns: ['a/**'] } },
    ];
    const zs = computeZones({ mode: 'layers', hierarchy: h, layers });
    expect(byKey(zs, 'Special').fileIds).toEqual(['file:a/y.ts']); // declared before the path match
    expect(byKey(zs, 'Pinned').fileIds).toEqual(['file:b/z.ts']);
    expect(byKey(zs, 'A').fileIds).toEqual(['file:a/x.ts']);
  });

  it('agrees with the rule engine: same layer for every file', () => {
    const paths = ['routes/u.ts', 'services/s.ts', 'data/d.ts', 'misc/m.ts'];
    const config: ArchitectureConfig = { version: 2, inferred_by: 'manual', inferred_at: '2026-01-01T00:00:00Z', layers: LAYERS };
    const entities = paths.map((p) => ({ ...fileEntity(p), id: `e:${p}` })) as never[];
    const map = buildLayerMap(entities, config);
    const { zs } = run(LAYERS, paths);
    for (const p of paths) {
      const engine = map.get(`e:${p}`) ?? ZONE_UNASSIGNED_KEY;
      expect(zs.zoneOfFile[`file:${p}`]).toBe(`zone:layers:${engine}`);
      expect(firstFileLayerIndex(p, LAYERS) >= 0).toBe(engine !== ZONE_UNASSIGNED_KEY);
    }
  });

  it('tooltip detail states the access rules', () => {
    const { zs } = run();
    expect(byKey(zs, 'Routes').detail).toBe('Layer Routes\nMay only access: Services');
    expect(byKey(zs, 'Services').detail).toContain('Must not access: Routes');
    expect(byKey(zs, 'Data').detail).toContain('No access rules');
    expect(byKey(zs, ZONE_UNASSIGNED_KEY).detail).toMatch(/no layer/i);
  });

  it('no layers: no zones at all (the canvas shows an empty state and groups by folders)', () => {
    const { zs } = run([]);
    expect(zs.zones).toEqual([]);
    expect(zs.rootIds).toEqual([]);
    expect(run(undefined).zs.zones.length).toBeGreaterThan(0);
  });

  it('duplicate layer names stay distinct zones', () => {
    const { zs } = run([{ name: 'L', include: { patterns: ['routes/**'] } }, { name: 'L', include: { patterns: ['data/**'] } }]);
    expect(zs.zones.filter((z) => z.source === 'layer').map((z) => z.key)).toEqual(['L', 'L#2']);
  });

  it('overrides apply like in other modes: rename, colour, collapse, pin, merge keep working', () => {
    const base = run().zs;
    const { zs } = run(LAYERS, PATHS, {
      overrides: ov(
        { 'layers:Routes': { name: 'HTTP', color: 4, collapsed: true }, 'layers:Data': { mergeInto: 'layers:Services' } },
        { 'src/shared/util.ts': 'layers:Services' },
      ),
    });
    expect(byKey(zs, 'Routes').label).toBe('HTTP');
    expect(byKey(zs, 'Routes').colorIndex).toBe(4);
    expect(byKey(zs, 'Routes').collapsed).toBe(true);
    expect(zs.zoneOfFile['file:src/shared/util.ts']).toBe('zone:layers:Services');
    expect(zs.zoneOfFile['file:data/user-repo.ts']).toBe('zone:layers:Services');
    expect(zs.zones.find((z) => z.key === 'Data')).toBeUndefined();
    // Order survives overrides: Routes still comes before Services.
    expect(zs.rootIds.indexOf('zone:layers:Routes')).toBeLessThan(zs.rootIds.indexOf('zone:layers:Services'));
    expect(byKey(base, 'Routes').collapsed).toBe(false);
    // An override can open the Unassigned bucket.
    const open = run(LAYERS, PATHS, { overrides: ov({ [`layers:${ZONE_UNASSIGNED_KEY}`]: { collapsed: false } }) }).zs;
    expect(byKey(open, ZONE_UNASSIGNED_KEY).collapsed).toBe(false);
  });

  it('deterministic: shuffled layers file order and entity order give the same zones', () => {
    const base = run().zs;
    for (const seed of [1, 2, 3]) {
      const paths = shuffled(PATHS, seed);
      const { zs } = run(LAYERS, paths);
      expect(zs.zones.map((z) => [z.id, z.fileIds, z.colorIndex])).toEqual(base.zones.map((z) => [z.id, z.fileIds, z.colorIndex]));
      expect(zs.rootIds).toEqual(base.rootIds);
    }
  });

  it('scope: only the files below the scope are zoned, patterns still match repo paths', () => {
    const { h } = treeOf(['pkg/routes/a.ts', 'pkg/data/b.ts', 'other/c.ts'], [['pkg', 'pkg']]);
    const zs = computeZones({
      mode: 'layers', hierarchy: h, scopeId: 'package:pkg',
      layers: [{ name: 'R', include: { patterns: ['pkg/routes/**'] } }],
    });
    expect(byKey(zs, 'R').fileIds).toEqual(['file:pkg/routes/a.ts']);
    expect(byKey(zs, ZONE_UNASSIGNED_KEY).fileIds).toEqual(['file:pkg/data/b.ts']);
    expect(zs.zoneOfFile['file:other/c.ts']).toBeUndefined();
  });
});
