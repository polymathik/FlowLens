import { describe, it, expect } from 'vitest';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { mergeAssignment, recordsAssignment } from '../../../src/canvas/utils/community-assignment';
import { monorepo, toHierarchy } from '../../unit/zones/communities/synth.js';
import type { MapViewOptions } from '../../../src/contracts/canvas/index.js';

const corpus = monorepo([
  { name: 'alpha', clusters: 5, min: 12, max: 16, seed: 1, noise: 0.05 },
  { name: 'beta', clusters: 1, min: 8, max: 10, seed: 2 },
]);
const { h, graph } = toHierarchy(corpus);
const options = (over: Partial<NonNullable<MapViewOptions['zones']>> = {}): MapViewOptions => ({
  showLockfiles: false,
  zones: { mode: 'communities', expansion: {}, fileGraph: graph, ...over },
});

describe('communities in the map view', () => {
  it('computeZoneView clusters on the given file graph and reports the mode it used', () => {
    const view = computeMapView(h, corpus.relations, ['package:packages/alpha'], options());
    expect(view.zoning?.mode).toBe('communities');
    expect(view.zoning?.zoneSet.quality).toBeDefined();
    const frames = view.cut!.items.filter((i) => i.kind === 'zone' && i.source === 'community');
    expect(frames.length).toBeGreaterThanOrEqual(4);
    expect(frames.every((f) => f.fileCount >= 5 && f.fileCount <= 40)).toBe(true);
    // accounting stays exact
    const a = view.accounting;
    expect(a.considered).toBe(a.edges + a.portalIn + a.portalOut + a.internal + a.hidden);
  });

  it('without a file graph the view still renders (folder affinity)', () => {
    const view = computeMapView(h, corpus.relations, ['package:packages/alpha'], options({ fileGraph: undefined }));
    expect(view.zoning?.mode).toBe('communities');
    expect(view.cut!.items.length).toBeGreaterThan(5);
  });

  it('passes the previous assignment through, so the zones keep their keys', () => {
    const first = computeMapView(h, corpus.relations, ['package:packages/alpha'], options());
    const prev = Object.fromEntries(first.zoning!.zoneSet.zones.flatMap((z) => z.fileIds.map((f) => [h.nodes.get(f)!.path, z.key])));
    const again = computeMapView(h, corpus.relations, ['package:packages/alpha'], options({ previousAssignment: prev }));
    expect(again.zoning!.zoneSet.zones.map((z) => z.key)).toEqual(first.zoning!.zoneSet.zones.map((z) => z.key));
  });

  it('the project view wraps multi-community packages in a package zone', () => {
    const view = computeMapView(h, corpus.relations, [], options());
    const alpha = view.zoning!.zoneSet.zones.find((z) => z.key === '@t/alpha')!;
    expect(alpha.childIds.length).toBeGreaterThanOrEqual(4);
    expect(view.cut!.items.find((i) => i.id === 'package:packages/alpha')).toBeDefined(); // double-click opens the package
  });
});

describe('mergeAssignment', () => {
  const zoneSet = computeMapView(h, corpus.relations, [], options()).zoning!.zoneSet;

  it('records community keys for every zoned file except config and pinned files', () => {
    const unpinned = mergeAssignment({}, zoneSet, h, {});
    const merged = mergeAssignment({}, zoneSet, h, { 'packages/alpha/src/auth/auth-service.ts': 'communities:whatever' });
    expect(Object.keys(merged).length).toBeGreaterThan(50);
    expect(unpinned['packages/alpha/src/auth/auth-service.ts']).toBeDefined();
    expect(merged['packages/alpha/src/auth/auth-service.ts']).toBeUndefined(); // pinned: not a detected membership
    expect(merged['packages/alpha/package.json']).toBeUndefined(); // manifest in the package zone
    expect(Object.keys(merged).every((p) => !p.startsWith('packages/beta/'))).toBe(true); // a single-zone package says nothing
  });

  it('returns the same object when nothing changed, drops files that no longer exist, keeps files of other scopes', () => {
    const first = mergeAssignment({}, zoneSet, h, {});
    expect(mergeAssignment(first, zoneSet, h, {})).toBe(first);
    const withStale = { ...first, 'gone/file.ts': 'x/y' };
    const pruned = mergeAssignment(withStale, zoneSet, h, {});
    expect(pruned['gone/file.ts']).toBeUndefined();
    expect(Object.keys(pruned)).toHaveLength(Object.keys(first).length);
    const alphaOnly = computeMapView(h, corpus.relations, ['package:packages/alpha'], options()).zoning!.zoneSet;
    const merged = mergeAssignment({ 'packages/beta/src/auth/auth-model.ts': 'kept/key' }, alphaOnly, h, {});
    expect(merged['packages/beta/src/auth/auth-model.ts']).toBe('kept/key');
  });

  it('only whole packages and the project record (folder views would overwrite a different partition)', () => {
    expect(recordsAssignment(h, 'project')).toBe(true);
    expect(recordsAssignment(h, 'package:packages/alpha')).toBe(true);
    expect(recordsAssignment(h, 'folder:packages/alpha/src')).toBe(false);
    expect(recordsAssignment(h, 'file:packages/alpha/package.json')).toBe(false);
  });
});
