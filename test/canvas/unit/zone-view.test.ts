import { describe, it, expect } from 'vitest';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { expansionKey } from '../../../src/canvas/utils/zone-cut';
import { getZones } from '../../../src/canvas/utils/zones-adapter';
import { ZONE_LAYOUT, type MapViewOptions } from '../../../src/contracts/canvas/index.js';
import { zoneFixture } from '../helpers/zone-fixture';

const { hierarchy: h, relations } = zoneFixture();
const opts = (over: Partial<MapViewOptions['zones'] & object> = {}, mode: 'packages' | 'folders' = 'packages'): MapViewOptions => ({
  showLockfiles: false,
  zones: { mode, expansion: {}, ...over },
});
const sum = (a: { edges: number; portalIn: number; portalOut: number; internal: number; hidden: number }) => a.edges + a.portalIn + a.portalOut + a.internal + a.hidden;

describe('zones adapter (local ZoneSet producer)', () => {
  it('packages mode hoists packages out of apps/ and packages/, keeps folders without packages, Config last', () => {
    const z = getZones({ mode: 'packages', hierarchy: h });
    const labels = z.rootIds.map((id) => z.zones.find((x) => x.id === id)!.label);
    expect(labels).toEqual(['@h/core', '@h/server', '@h/web', 'docs', 'Config']);
    const server = z.zones.find((x) => x.label === '@h/server')!;
    expect(server.fileIds).toHaveLength(8); // flat: src, adapters and test files
    expect(server.stats.files).toBe(8);
    expect(z.zoneOfFile['file:packages/core/src/ids.ts']).toBe(z.zones.find((x) => x.label === '@h/core')!.id);
  });

  it('folders mode nests like the directory tree and a file belongs to at most one zone', () => {
    const z = getZones({ mode: 'folders', hierarchy: h, scopeId: 'folder:packages/server/src' });
    const labels = z.rootIds.map((id) => z.zones.find((x) => x.id === id)!.label);
    expect(labels).toContain('adapters');
    const adapters = z.zones.find((x) => x.label === 'adapters')!;
    expect(adapters.childIds).toHaveLength(2); // codex, claude
    expect(adapters.fileIds).toEqual(['file:packages/server/src/adapters/cursor.ts']);
    const owners = new Map<string, number>();
    for (const zone of z.zones) for (const f of zone.fileIds) owners.set(f, (owners.get(f) ?? 0) + 1);
    expect([...owners.values()].every((c) => c === 1)).toBe(true);
    expect(z.zoneOfFile['file:packages/server/src/adapters/codex/codex.ts']).toContain('codex');
    expect(z.zoneOfFile['file:packages/server/src/cli.ts']).toBeUndefined(); // direct file: loose
  });

  it('overrides rename, recolour, collapse and pin files', () => {
    const base = getZones({ mode: 'packages', hierarchy: h });
    const server = base.zones.find((x) => x.label === '@h/server')!;
    const z = getZones({
      mode: 'packages',
      hierarchy: h,
      overrides: { version: 1, zones: { [`packages:${server.key}`]: { name: 'Backend', color: 2, collapsed: true } }, pins: { 'docs/tool.ts': `packages:${server.key}` } },
    });
    const s = z.zones.find((x) => x.key === server.key)!;
    expect([s.label, s.colorIndex, s.collapsed, s.customized]).toEqual(['Backend', 2, true, true]);
    expect(z.zoneOfFile['file:docs/tool.ts']).toBe(s.id);
    expect(z.zones.find((x) => x.label === 'docs')).toBeUndefined(); // emptied zones are dropped
  });
});

describe('computeMapView with zones: the cut', () => {
  it('small container: every zone is a frame holding its cards; ids are hierarchy ids', () => {
    const v = computeMapView(h, relations, [], opts());
    const cut = v.cut!;
    const server = cut.items.find((i) => i.id === 'package:packages/server')!;
    expect(server.expanded).toBe(true);
    expect(server.fileCount).toBe(8);
    const cards = cut.items.filter((i) => i.kind === 'file' && i.parentId === 'package:packages/server');
    expect(cards.map((c) => c.id)).toContain('file:packages/server/src/adapters/codex/codex.ts');
    // parents before children
    const index = new Map(cut.items.map((i, n) => [i.id, n]));
    for (const i of cut.items) if (i.parentId) expect(index.get(i.parentId)!).toBeLessThan(index.get(i.id)!);
    // lockfile hidden; Config zone is a collapsed card by default
    expect(cut.items.some((i) => i.id.endsWith('pnpm-lock.yaml'))).toBe(false);
    expect(cut.items.find((i) => i.source === 'config')!.expanded).toBe(false);
  });

  it('explicit choices beat defaults; the depth cap keeps deep zones as cards', () => {
    const collapsed = computeMapView(h, relations, [], opts({ expansion: { [expansionKey('project', 'package:packages/server')]: false } })).cut!;
    expect(collapsed.items.find((i) => i.id === 'package:packages/server')).toMatchObject({ expanded: false, collapsedBy: 'user' });
    expect(collapsed.items.some((i) => i.parentId === 'package:packages/server')).toBe(false);
    expect(collapsed.atomOfFile['file:packages/server/src/a.ts']).toBe('package:packages/server');
    const deep = computeMapView(h, relations, ['folder:packages', 'package:packages/server'], opts({}, 'folders')).cut!;
    expect(deep.items.find((i) => i.id === 'folder:packages/server/src/adapters')!.depth).toBe(1);
    const tight = computeMapView(h, relations, [], opts({ expansion: {} }, 'folders')).cut!;
    const depths = tight.items.filter((i) => i.kind === 'zone').map((i) => i.depth);
    expect(Math.max(...depths)).toBeLessThanOrEqual(ZONE_LAYOUT.maxDepth);
    expect(tight.items.filter((i) => i.depth >= ZONE_LAYOUT.maxDepth && i.kind === 'zone').every((i) => !i.expanded)).toBe(true);
  });

  it('large container: only zones of at most 25 files start expanded', () => {
    const extra = Array.from({ length: 130 }, (_, i) => `packages/big/src/f${String(i).padStart(3, '0')}.ts`);
    const big = zoneFixture(extra);
    const v = computeMapView(big.hierarchy, big.relations, [], opts());
    const byLabel = (l: string) => v.cut!.items.find((i) => i.label === l)!;
    // `packages/big/src` has no manifest: a plain folder zone with 130 files, collapsed; the small zones stay open
    const bigZone = v.cut!.items.find((i) => i.kind === 'zone' && i.fileCount === 130)!;
    expect(bigZone.expanded).toBe(false);
    expect(bigZone.collapsedBy).toBe('default');
    expect(byLabel('@h/core').expanded).toBe(true);
  });

  it('node budget collapses the largest default-expanded zones first and counts them; user-expanded zones stay', () => {
    const extra = Array.from({ length: 40 }, (_, i) => `packages/server/src/gen/g${i}.ts`);
    const big = zoneFixture(extra);
    const v = computeMapView(big.hierarchy, big.relations, [], opts({ nodeBudget: 40 }));
    expect(v.cut!.budgetCollapsed).toBeGreaterThan(0);
    expect(v.cut!.items.length).toBeLessThanOrEqual(40 - 24 + 8); // fits (collapsed zones keep their own card)
    const server = v.cut!.items.find((i) => i.id === 'package:packages/server')!;
    expect(server).toMatchObject({ expanded: false, collapsedBy: 'budget' });
    const kept = computeMapView(big.hierarchy, big.relations, [], opts({ nodeBudget: 40, expansion: { [expansionKey('project', 'package:packages/server')]: true } }));
    expect(kept.cut!.items.find((i) => i.id === 'package:packages/server')!.expanded).toBe(true);
  });

  it('reveal expands the zones that contain a file', () => {
    const base = computeMapView(h, relations, [], opts({ expansion: { [expansionKey('project', 'package:packages/server')]: false } }));
    expect(base.cut!.atomOfFile['file:packages/server/src/a.ts']).toBe('package:packages/server');
    const rev = computeMapView(h, relations, [], opts({ expansion: { [expansionKey('project', 'package:packages/server')]: false }, reveal: ['package:packages/server'] }));
    expect(rev.cut!.atomOfFile['file:packages/server/src/a.ts']).toBe('file:packages/server/src/a.ts');
  });

  it('a container with nothing to group (no sub-folders) shows no fallback notice', () => {
    const v = computeMapView(h, relations, ['folder:docs'], opts());
    expect(v.zoning!.mode).toBe(v.zoning!.requested);
    expect(v.cut!.items.some((i) => i.kind === 'zone')).toBe(false);
  });

  it('modes the local producer does not know (communities, layers) are shown as folders', () => {
    const v = computeMapView(h, relations, [], opts({}, 'communities' as 'packages'));
    expect(v.cut!.items.some((i) => i.id === 'package:packages/server')).toBe(true);
  });
});

describe('computeMapView with zones: links, bundles, portals and exact accounting', () => {
  it('every relation is in exactly one bucket and every cross link is in exactly one bundle', () => {
    for (const exp of [{}, { [expansionKey('project', 'package:packages/server')]: false }]) {
      const v = computeMapView(h, relations, [], opts({ expansion: exp }));
      const a = v.accounting;
      expect(a.considered).toBe(sum(a));
      expect(a.considered).toBe(relations.filter((r) => r.type !== 'contain').length);
      expect(v.links.reduce((s, l) => s + l.count, 0)).toBe(a.edges);
      const cross = v.links.filter((l) => l.cross).reduce((s, l) => s + l.count, 0);
      expect(v.bundles!.reduce((s, l) => s + l.count, 0)).toBe(cross);
      expect(a.portalIn + a.portalOut).toBe(0); // root: nothing leaves the project
    }
  });

  it('bundles run between the highest differing frames; siblings under one frame stay individual', () => {
    const v = computeMapView(h, relations, [], opts());
    const bundle = v.bundles!.find((b) => b.source === 'package:packages/server' && b.target === 'package:packages/core')!;
    expect(bundle.count).toBe(4); // a.ts, b.ts (imports), codex (call), claude (import) → core
    expect(bundle.typeCounts).toEqual({ import: 3, call: 1 });
    // two cards inside the same frame: an individual (non-cross) link
    expect(v.links.find((l) => l.source === 'file:apps/web/src/app.ts' && l.target === 'file:apps/web/src/ui/button.ts')!.cross).toBeUndefined();
    // a card in one frame to a card in another: dimmed detail link, same relation inside the bundle
    const detail = v.links.find((l) => l.source === 'file:packages/server/src/a.ts' && l.target === 'file:packages/core/src/adapter.ts')!;
    expect(detail.cross).toBe(true);
  });
});
