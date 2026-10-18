import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { computeZones } from '../../../src/analysis/zones/index.js';
import { ZONE_CONFIG_KEY } from '../../../src/contracts/zones.js';
import { allFileIds, byKey, expectConsistent, outline, shuffled, treeOf, treeOfDir } from './helpers.js';

const FIXTURE = join(import.meta.dirname, '../../fixtures/built-monorepo');

describe('packages mode', () => {
  it('built-monorepo fixture: one zone per workspace package plus a muted Config zone', () => {
    const { h } = treeOfDir(FIXTURE);
    const zs = computeZones({ mode: 'packages', hierarchy: h });
    expect(zs.mode).toBe('packages');
    expect(outline(zs)).toEqual(['@scope/core (6)', '@scope/server (5)', '@scope/shared (3)', 'web (12)', 'Config (5)']);
    expect(zs.zones.map((z) => z.source)).toEqual(['package', 'package', 'package', 'package', 'config']);
    expect(byKey(zs, ZONE_CONFIG_KEY).fileIds).toEqual(
      ['file:.gitignore', 'file:package.json', 'file:pnpm-lock.yaml', 'file:pnpm-workspace.yaml', 'file:tsconfig.base.json'],
    );
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
    expect(zs.zones.every((z) => z.id === `zone:packages:${z.key}`)).toBe(true);
  });

  it('keeps a package own config (package.json, tsconfig) inside the package zone', () => {
    const { h } = treeOfDir(FIXTURE);
    const core = byKey(computeZones({ mode: 'packages', hierarchy: h }), '@scope/core');
    expect(core.fileIds).toContain('file:packages/core/package.json');
    expect(core.nodeId).toBe('package:packages/core');
  });

  it('groups files outside packages by top-level directory, with Root and Config zones', () => {
    const { h } = treeOf(
      ['packages/a/src/x.ts', 'packages/a/package.json', 'scripts/build.ts', 'scripts/tsconfig.json', 'docs/guide/intro.md', 'docs/guide/more.md', 'README.md', 'tsconfig.json', 'pnpm-lock.yaml'],
      [['packages/a', 'pkg-a']],
    );
    const zs = computeZones({ mode: 'packages', hierarchy: h });
    // docs holds a single child folder: the hierarchy collapses it to docs/guide, and so does the zone.
    expect(outline(zs)).toEqual(['docs/guide (2)', 'pkg-a (2)', 'Root (1)', 'scripts (1)', 'Config (3)']);
    expect(byKey(zs, 'scripts').fileIds).toEqual(['file:scripts/build.ts']);
    expect(byKey(zs, ZONE_CONFIG_KEY).fileIds).toContain('file:scripts/tsconfig.json');
    expect(byKey(zs, '.').label).toBe('Root');
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('nests a package inside the package that contains it and disambiguates clashing names', () => {
    const { h } = treeOf(
      ['packages/outer/package.json', 'packages/outer/src/a.ts', 'packages/outer/plugins/inner/package.json', 'packages/outer/plugins/inner/b.ts', 'tools/x/package.json', 'tools/x/c.ts'],
      [['packages/outer', 'outer'], ['packages/outer/plugins/inner', 'inner'], ['tools/x', 'outer']],
    );
    const zs = computeZones({ mode: 'packages', hierarchy: h });
    const inner = byKey(zs, 'inner');
    expect(inner.parentId).toBe('zone:packages:outer');
    expect(byKey(zs, 'outer').childIds).toEqual([inner.id]);
    expect(byKey(zs, 'outer').stats.files).toBe(4); // own 2 + inner 2
    expect(zs.zones.filter((z) => z.label === 'outer').map((z) => z.key).sort()).toEqual(['outer', 'outer@tools/x']);
    expect(expectConsistent(zs, allFileIds(h))).toEqual([]);
  });

  it('works without any package: top-level directories and Config', () => {
    const { h } = treeOf(['src/a.ts', 'src/b.ts', 'test/a.test.ts', 'package.json']);
    expect(outline(computeZones({ mode: 'packages', hierarchy: h }))).toEqual(['src (2)', 'test (1)', 'Config (1)']);
  });

  it('scopeId zones only the files below that node', () => {
    const { h } = treeOfDir(FIXTURE);
    const zs = computeZones({ mode: 'packages', hierarchy: h, scopeId: 'package:apps/web' });
    const files = zs.zones.flatMap((z) => z.fileIds);
    expect(files.length).toBe(12);
    expect(files.every((f) => f.startsWith('file:apps/web/'))).toBe(true);
    expect(outline(zs)).toEqual(['src (9)', 'Config (3)']);
    expect(computeZones({ mode: 'packages', hierarchy: h, scopeId: 'file:packages/core/src/index.ts' }).zones).toEqual([]);
    expect(computeZones({ mode: 'packages', hierarchy: h, scopeId: 'folder:nope' }).zones).toEqual([]);
  });

  it('is deterministic: shuffled entities and package order give the identical ZoneSet', () => {
    const paths = ['packages/a/src/x.ts', 'packages/a/package.json', 'packages/b/src/y.ts', 'scripts/s.ts', 'docs/a.md', 'docs/b.md', 'README.md', 'tsconfig.json', 'apps/web/src/m.ts', 'apps/web/package.json'];
    const pk: Array<[string, string]> = [['packages/a', 'A'], ['packages/b', 'b'], ['apps/web', 'web']];
    const reference = computeZones({ mode: 'packages', hierarchy: treeOf(paths, pk).h });
    for (let seed = 1; seed <= 8; seed++) {
      const t = treeOf(shuffled(paths, seed), shuffled(pk, seed + 100));
      expect(computeZones({ mode: 'packages', hierarchy: t.h })).toEqual(reference);
    }
  });
});
