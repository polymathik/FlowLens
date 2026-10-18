import { describe, it, expect } from 'vitest';
import { computeZones, hasZoning, hashKey } from '../../../src/analysis/zones/index.js';
import { ZONE_COLOR_SLOTS, ZONE_CONFIG_KEY, ZONING_MODES } from '../../../src/contracts/zones.js';
import { allFileIds, byKey, expectConsistent, outline, shuffled, symbolEntity, treeOf } from './helpers.js';

const PATHS = [
  'src/adapters/codex/codex.ts', 'src/adapters/codex/parse.ts', 'src/adapters/claude/a.ts',
  'src/core/a.ts', 'src/core/deep/only/b.ts', 'src/core/deep/only/c.ts',
  'apps/web/package.json', 'apps/web/src/x.ts',
  'README.md', 'package.json', 'tsconfig.json',
];
const PKG: Array<[string, string]> = [['apps/web', '@x/web']];

describe('folders mode', () => {
  it('mirrors the collapsed hierarchy as nested zones; bridge folders add no zone', () => {
    const { h } = treeOf(PATHS, PKG);
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    expect(outline(zs)).toEqual([
      '@x/web (2)',
      '  src (1)',
      'Root (1)',
      'src (6)',
      '  adapters (3)',
      '    claude (1)',
      '    codex (2)',
      '  core (3)',
      '    deep/only (2)',
      'Config (2)',
    ]);
    // `apps` only bridges to the package: no zone of its own, the package is top-level.
    expect(zs.zones.find((z) => z.key === 'apps')).toBeUndefined();
    expect(byKey(zs, 'apps/web').source).toBe('package');
    expect(byKey(zs, 'src/core/deep/only').parentId).toBe('zone:folders:src/core');
    expect(byKey(zs, ZONE_CONFIG_KEY).source).toBe('config');
    expect(byKey(zs, '.').fileIds).toEqual(['file:README.md']);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('a folder that only holds packages (packages/, apps/) is a bridge, not a zone', () => {
    const { h } = treeOf(['packages/a/src/x.ts', 'packages/b/src/y.ts', 'packages/shared.ts', 'apps/w/src/z.ts', 'apps/v/src/q.ts'], [['packages/a', 'A'], ['packages/b', 'B'], ['apps/w', 'W'], ['apps/v', 'V']]);
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    // `packages/` also holds a file of its own, so it IS a zone; `apps/` only holds packages, so it is not.
    expect(outline(zs)).toEqual(['packages (3)', '  A (1)', '    src (1)', '  B (1)', '    src (1)', 'V (1)', '  src (1)', 'W (1)', '  src (1)']);
    expect(zs.zones.find((z) => z.key === 'apps')).toBeUndefined();
  });

  it('src has no files of its own but two child folders, so it is a zone; a single bridge folder is not', () => {
    const { h } = treeOf(['a/b/c.ts', 'a/b/d.ts', 'x/y/z/q.ts', 'x/w.ts']);
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    expect(zs.zones.map((z) => z.key)).toEqual(['a/b', 'x', 'x/y/z']);
  });

  it('caps nesting: deeper folders merge into the depth-cap zone, which starts collapsed; stats keep covering all', () => {
    const { h } = treeOf(PATHS, PKG);
    const zs = computeZones({ mode: 'folders', hierarchy: h, options: { maxDepth: 2 } });
    expect(outline(zs)).toEqual(['@x/web (2)', '  src (1)', 'Root (1)', 'src (6)', '  adapters (3)', '  core (3)', 'Config (2)']);
    const adapters = byKey(zs, 'src/adapters');
    expect(adapters.fileIds).toEqual(['file:src/adapters/claude/a.ts', 'file:src/adapters/codex/codex.ts', 'file:src/adapters/codex/parse.ts']);
    expect(adapters.collapsed).toBe(true);
    expect(adapters.stats.files).toBe(3);
    expect(byKey(zs, 'src/core').fileIds).toContain('file:src/core/deep/only/b.ts');
    expect(byKey(zs, 'src').collapsed).toBe(false);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
    const one = computeZones({ mode: 'folders', hierarchy: h, options: { maxDepth: 1 } });
    expect(one.zones.filter((z) => z.parentId !== null)).toEqual([]);
    expect(byKey(one, 'src').fileIds.length).toBe(6);
  });

  it('collapses zones with more files than the threshold (default 60)', () => {
    const many = Array.from({ length: 61 }, (_, i) => `big/f${i}.ts`);
    const { h } = treeOf([...many, 'small/a.ts']);
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    expect(byKey(zs, 'big').collapsed).toBe(true);
    expect(byKey(zs, 'small').collapsed).toBe(false);
    const raised = computeZones({ mode: 'folders', hierarchy: h, options: { collapseAbove: 61 } });
    expect(byKey(raised, 'big').collapsed).toBe(false);
  });

  it('scopeId zones the open container: its root files become the Root zone named after it', () => {
    const { h } = treeOf(PATHS, PKG);
    const zs = computeZones({ mode: 'folders', hierarchy: h, scopeId: 'folder:src' });
    expect(outline(zs)).toEqual(['adapters (3)', '  claude (1)', '  codex (2)', 'core (3)', '  deep/only (2)']);
    const pkgScope = computeZones({ mode: 'folders', hierarchy: h, scopeId: 'package:apps/web' });
    expect(outline(pkgScope)).toEqual(['src (1)', 'Config (1)']);
    expect(byKey(pkgScope, ZONE_CONFIG_KEY).fileIds).toEqual(['file:apps/web/package.json']);
    const rooted = treeOf(['src/a.ts', 'src/sub/b.ts', 'src/sub2/c.ts']);
    const r = computeZones({ mode: 'folders', hierarchy: rooted.h, scopeId: 'folder:src' });
    expect(byKey(r, 'src').label).toBe('src');
    expect(byKey(r, 'src').fileIds).toEqual(['file:src/a.ts']);
  });

  it('aggregates stats from files (symbols, lines, mean quality, max churn/hotspot, folders)', () => {
    const { h } = treeOf(['m/a.ts', 'm/b.ts', 'm/sub/c.ts', 'm/sub2/d.ts'], [], [
      symbolEntity('m/a.ts', 'one', 100), symbolEntity('m/a.ts', 'two', 60), symbolEntity('m/sub/c.ts', 'three', 80),
    ]);
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    const m = byKey(zs, 'm');
    expect(m.stats).toMatchObject({ files: 4, symbols: 3, folders: 2, churn: 2, hotspot: 3 });
    expect(m.stats.quality).toBe(80);
    expect(m.stats.lines).toBe(h.nodes.get('folder:m')!.stats.lines);
    expect(m.stats.quality).toBe(h.nodes.get('folder:m')!.stats.quality);
  });

  it('colours: stable per key, siblings differ, children differ from their parent', () => {
    const { h } = treeOf(Array.from({ length: 6 }, (_, i) => `dir${i}/a.ts`).concat(['dir0/sub/b.ts', 'dir0/sub2/c.ts']));
    const zs = computeZones({ mode: 'folders', hierarchy: h });
    const top = zs.rootIds.map((id) => zs.zones.find((z) => z.id === id)!);
    expect(top.length).toBe(6);
    expect(new Set(top.map((z) => z.colorIndex)).size).toBe(ZONE_COLOR_SLOTS);
    expect(top.every((z) => z.colorIndex >= 0 && z.colorIndex < ZONE_COLOR_SLOTS)).toBe(true);
    const dir0 = byKey(zs, 'dir0');
    const kids = dir0.childIds.map((id) => zs.zones.find((z) => z.id === id)!);
    expect(kids.length).toBe(2);
    expect(kids.every((k) => k.colorIndex !== dir0.colorIndex)).toBe(true);
    expect(kids[0].colorIndex).not.toBe(kids[1].colorIndex);
    // A lone zone keeps exactly its hash slot.
    const alone = computeZones({ mode: 'folders', hierarchy: treeOf(['solo/a.ts']).h });
    expect(byKey(alone, 'solo').colorIndex).toBe(hashKey('solo') % ZONE_COLOR_SLOTS);
    // With more siblings than slots no two neighbours share a colour.
    const wide = treeOf(Array.from({ length: 20 }, (_, i) => `w${i}/a.ts`));
    const ws = computeZones({ mode: 'folders', hierarchy: wide.h });
    const seq = ws.rootIds.map((id) => ws.zones.find((z) => z.id === id)!.colorIndex);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });

  it('is deterministic under shuffled input and sorted by label, case-insensitively', () => {
    const paths = [...PATHS, 'Zeta/a.ts', 'alpha/a.ts', 'Beta/a.ts'];
    const ref = computeZones({ mode: 'folders', hierarchy: treeOf(paths, PKG).h });
    expect(ref.rootIds.map((id) => ref.zones.find((z) => z.id === id)!.label)) // Config always last.toEqual(['@x/web', 'alpha', 'Beta', 'Root', 'src', 'Zeta', 'Config']);
    for (let seed = 1; seed <= 8; seed++) {
      expect(computeZones({ mode: 'folders', hierarchy: treeOf(shuffled(paths, seed), PKG).h })).toEqual(ref);
    }
  });

  it('falls back to folders for modes without a strategy and says so', () => {
    const { h } = treeOf(PATHS, PKG);
    const base = computeZones({ mode: 'folders', hierarchy: h });
    for (const mode of ZONING_MODES.filter((m) => !hasZoning(m))) {
      const zs = computeZones({ mode, hierarchy: h });
      expect(zs.fallbackFrom).toBe(mode);
      expect(zs.mode).toBe('folders');
      expect(zs.zones).toEqual(base.zones);
    }
    expect(base.fallbackFrom).toBeUndefined();
  });
});
