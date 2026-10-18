import { describe, it, expect } from 'vitest';
import { computeZones } from '../../../src/analysis/zones/index.js';
import { EMPTY_ZONE_OVERRIDES, type ZoneOverrides, type ZoningMode } from '../../../src/contracts/zones.js';
import { allFileIds, byKey, expectConsistent, outline, shuffled, treeOf } from './helpers.js';

const PATHS = [
  'src/adapters/codex/codex.ts', 'src/adapters/codex/parse.ts', 'src/adapters/claude/a.ts',
  'src/core/a.ts', 'src/core/b.ts', 'docs/guide.md', 'docs/more.md', 'tsconfig.json',
];
const ov = (zones: ZoneOverrides['zones'] = {}, pins: ZoneOverrides['pins'] = {}): ZoneOverrides => ({ version: 1, zones, pins });
const run = (overrides?: ZoneOverrides, mode: ZoningMode = 'folders', extra: Partial<Parameters<typeof computeZones>[0]> = {}) => {
  const { h } = treeOf(PATHS);
  return { h, zs: computeZones({ mode, hierarchy: h, overrides, ...extra }) };
};

describe('overrides', () => {
  it('empty overrides change nothing and are not marked customized', () => {
    const base = run().zs;
    expect(run(EMPTY_ZONE_OVERRIDES).zs).toEqual(base);
    expect(base.zones.some((z) => z.customized)).toBe(false);
  });

  it('rename, colour and collapse win over generated values and mark the zone customized', () => {
    const base = run().zs;
    const { zs } = run(ov({
      'folders:src/core': { name: '  Core engine ', color: (byKey(base, 'src/core').colorIndex + 3) % 6, collapsed: true },
      'folders:docs': { collapsed: false },
    }));
    const core = byKey(zs, 'src/core');
    expect(core.label).toBe('Core engine');
    expect(core.colorIndex).toBe((byKey(base, 'src/core').colorIndex + 3) % 6);
    expect(core.collapsed).toBe(true);
    expect(core.customized).toBe(true);
    expect(byKey(zs, 'docs').customized).toBe(true);
    expect(byKey(zs, 'src/adapters').customized).toBeUndefined();
    expect(core.id).toBe('zone:folders:src/core'); // the key, hence the id, never changes
  });

  it('a forced collapse flag beats the automatic one in both directions', () => {
    const many = Array.from({ length: 70 }, (_, i) => `big/f${i}.ts`);
    const h = treeOf(many).h;
    expect(byKey(computeZones({ mode: 'folders', hierarchy: h }), 'big').collapsed).toBe(true);
    expect(byKey(computeZones({ mode: 'folders', hierarchy: h, overrides: ov({ 'folders:big': { collapsed: false } }) }), 'big').collapsed).toBe(false);
  });

  it('renaming re-sorts by the new label; a forced colour is respected by its siblings', () => {
    const { zs } = run(ov({ 'folders:docs': { name: 'Zzz', color: 2 }, 'folders:src': { color: 2 } }));
    expect(zs.rootIds.map((id) => zs.zones.find((z) => z.id === id)!.label)).toEqual(['src', 'Zzz', 'Config']);
    expect(byKey(zs, 'docs').colorIndex).toBe(2);
  });

  it('a pin moves a file to another zone; stats and membership stay consistent', () => {
    const { h, zs } = run(ov({}, { 'src/core/a.ts': 'folders:docs' }));
    expect(byKey(zs, 'docs').fileIds).toEqual(['file:docs/guide.md', 'file:docs/more.md', 'file:src/core/a.ts']);
    expect(byKey(zs, 'src/core').fileIds).toEqual(['file:src/core/b.ts']);
    expect(zs.zoneOfFile['file:src/core/a.ts']).toBe('zone:folders:docs');
    expect(byKey(zs, 'docs').customized).toBe(true);
    expect(byKey(zs, 'src/core').customized).toBe(true);
    expect(byKey(zs, 'docs').stats.files).toBe(3);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('a pin to a missing zone creates a custom top-level zone; emptied zones disappear', () => {
    const { h, zs } = run(ov({}, { 'docs/guide.md': 'folders:Reading', 'docs\\more.md': 'folders:Reading' }));
    const reading = byKey(zs, 'Reading');
    expect(reading).toMatchObject({ source: 'custom', label: 'Reading', parentId: null, customized: true });
    expect(reading.fileIds).toEqual(['file:docs/guide.md', 'file:docs/more.md']);
    expect(zs.zones.find((z) => z.key === 'docs')).toBeUndefined();
    expect(zs.rootIds).toContain(reading.id);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('ignores pins for unknown files, other modes and files outside the scope', () => {
    const base = run().zs;
    expect(run(ov({}, { 'nope/x.ts': 'folders:docs', 'src/core/a.ts': 'packages:docs' })).zs).toEqual(base);
    const scoped = run(ov({}, { 'docs/guide.md': 'folders:src/core' }), 'folders', { scopeId: 'folder:src' }).zs;
    expect(scoped.zones.flatMap((z) => z.fileIds)).not.toContain('file:docs/guide.md');
  });

  it('mergeInto folds a zone into another; its children are re-parented and files kept', () => {
    const { h, zs } = run(ov({ 'folders:src/adapters': { mergeInto: 'folders:src/core' } }));
    expect(zs.zones.find((z) => z.key === 'src/adapters')).toBeUndefined();
    const core = byKey(zs, 'src/core');
    expect(core.childIds).toEqual(['zone:folders:src/adapters/claude', 'zone:folders:src/adapters/codex']);
    expect(byKey(zs, 'src/adapters/codex').parentId).toBe(core.id);
    expect(core.customized).toBe(true);
    expect(core.stats.files).toBe(5);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
    const flat = run(ov({ 'folders:docs': { mergeInto: 'folders:src/core' } })).zs;
    expect(byKey(flat, 'src/core').fileIds.length).toBe(4);
  });

  it('merge chains resolve; cycles, self-merges, missing targets and merges into a descendant are ignored', () => {
    const chain = run(ov({ 'folders:docs': { mergeInto: 'folders:src/core' }, 'folders:src/core': { mergeInto: 'folders:src/adapters/claude' } })).zs;
    expect(chain.zones.find((z) => z.key === 'docs')).toBeUndefined();
    expect(chain.zones.find((z) => z.key === 'src/core')).toBeUndefined();
    expect(byKey(chain, 'src/adapters/claude').fileIds.length).toBe(5);
    const cycle = run(ov({ 'folders:docs': { mergeInto: 'folders:src/core' }, 'folders:src/core': { mergeInto: 'folders:docs' } })).zs;
    expect(cycle.zones.map((z) => z.key).sort()).toEqual(['src', 'src/adapters', 'src/adapters/claude', 'src/adapters/codex', '<config>', 'src/core'].sort().filter((k) => k !== 'docs'));
    const odd = run(ov({
      'folders:docs': { mergeInto: 'folders:docs' }, 'folders:src/core': { mergeInto: 'folders:ghost' },
      'folders:src': { mergeInto: 'folders:src/adapters/codex' },
    })).zs;
    expect(odd.zones.map((z) => z.key)).toContain('docs');
    expect(odd.zones.map((z) => z.key)).toContain('src');
    expect(expectConsistent(odd, allFileIds(treeOf(PATHS).h))).toEqual([]);
  });

  it('merge targets accept a bare key; keys of another mode are ignored', () => {
    const bare = run(ov({ 'folders:docs': { mergeInto: 'src/core' } })).zs;
    expect(byKey(bare, 'src/core').fileIds.length).toBe(4);
    const other = run(ov({ 'packages:docs': { name: 'X' }, 'folders:docs': { mergeInto: 'packages:src/core' } })).zs;
    expect(byKey(other, 'docs').label).toBe('docs');
  });

  it('overrides apply in packages mode under their own prefix', () => {
    const { h } = treeOf(['packages/a/x.ts', 'packages/b/y.ts', 'packages/b/z.ts'], [['packages/a', 'A'], ['packages/b', 'B']]);
    const zs = computeZones({ mode: 'packages', hierarchy: h, overrides: ov({ 'packages:A': { name: 'Alpha' }, 'folders:A': { name: 'no' } }, { 'packages/b/z.ts': 'packages:A' }) });
    expect(byKey(zs, 'A').label).toBe('Alpha');
    expect(byKey(zs, 'A').fileIds).toEqual(['file:packages/a/x.ts', 'file:packages/b/z.ts']);
    expect(byKey(zs, 'B').fileIds).toEqual(['file:packages/b/y.ts']);
  });

  it('is deterministic regardless of override key order', () => {
    const entries: Array<[string, ZoneOverrides['zones'][string]]> = [
      ['folders:docs', { name: 'D' }], ['folders:src/core', { mergeInto: 'folders:docs' }], ['folders:src', { color: 1 }],
    ];
    const pins: Array<[string, string]> = [['src/adapters/codex/codex.ts', 'folders:docs'], ['tsconfig.json', 'folders:src']];
    const ref = run(ov(Object.fromEntries(entries), Object.fromEntries(pins))).zs;
    for (let seed = 1; seed <= 6; seed++) {
      expect(run(ov(Object.fromEntries(shuffled(entries, seed)), Object.fromEntries(shuffled(pins, seed)))).zs).toEqual(ref);
    }
    expect(outline(ref).length).toBeGreaterThan(0);
  });
});
