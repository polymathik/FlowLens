import { describe, it, expect, beforeEach } from 'vitest';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { expansionKey } from '../../../src/canvas/utils/zone-cut';
import { layoutCut, clearCutLayoutCache, rowsFor, type BoxPos } from '../../../src/canvas/layout/cut-layout';
import { shelfPack, gridPack } from '../../../src/canvas/layout/zone-pack';
import { quantizeZoom, isSummaryTier, showsSymbolRows, labelScale } from '../../../src/canvas/utils/lod';
import { emphasise, DETAIL_EDGE_LIMIT } from '../../../src/canvas/utils/emphasis';
import { createCanvasStore } from '../../../src/canvas/store/canvas-store';
import { applyOverrideEdit } from '../../../src/canvas/hooks/useZoneOverrides';
import { renameZone, recolorZone, collapseZone, pinFile, unpinFile } from '../../../src/canvas/utils/zone-overrides';
import { EMPTY_ZONE_OVERRIDES, ZONE_COLOR_SLOTS } from '../../../src/contracts/zones.js';
import type { MapCut, MapViewOptions } from '../../../src/contracts/canvas/index.js';
import { zoneFixture } from '../helpers/zone-fixture';
import type { Edge, Node } from '@xyflow/react';

const opts = (zones: Partial<NonNullable<MapViewOptions['zones']>> = {}): MapViewOptions => ({ showLockfiles: false, zones: { mode: 'packages', expansion: {}, ...zones } });

async function layoutOf(cut: MapCut): Promise<Map<string, BoxPos>> {
  return layoutCut({ cut, links: [], extras: [], rowsOf: () => 2 });
}
const inside = (a: BoxPos, b: BoxPos) => a.x >= -0.5 && a.y >= -0.5 && a.x + a.w <= b.w + 0.5 && a.y + a.h <= b.h + 0.5;
const overlap = (a: BoxPos, b: BoxPos) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('zone layout: containment and no overlap', () => {
  beforeEach(() => clearCutLayoutCache());

  it('every card is inside its frame, siblings never overlap, and the layout is deterministic', async () => {
    const { hierarchy: h, relations } = zoneFixture();
    const v = computeMapView(h, relations, [], opts());
    const cut = v.cut!;
    const links = v.links.map((l) => ({ source: l.source, target: l.target }));
    const a = await layoutCut({ cut, links, extras: [], rowsOf: () => 2 });
    for (const item of cut.items) {
      const box = a.get(item.id)!;
      expect(box, item.id).toBeDefined();
      if (item.parentId) expect(inside(box, a.get(item.parentId)!), `${item.id} in ${item.parentId}`).toBe(true);
    }
    const groups = new Map<string | null, string[]>();
    for (const item of cut.items) groups.set(item.parentId, [...(groups.get(item.parentId) ?? []), item.id]);
    for (const [, ids] of groups) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(overlap(a.get(ids[i])!, a.get(ids[j])!), `${ids[i]} / ${ids[j]}`).toBe(false);
    clearCutLayoutCache();
    const b = await layoutCut({ cut, links, extras: [], rowsOf: () => 2 });
    expect([...b.entries()]).toEqual([...a.entries()]);
  });

  it('a second layout of the same cut is served from the cache', async () => {
    const { hierarchy: h, relations } = zoneFixture();
    const cut = computeMapView(h, relations, [], opts()).cut!;
    const t0 = performance.now();
    await layoutOf(cut);
    const first = performance.now() - t0;
    const t1 = performance.now();
    await layoutOf(cut);
    expect(performance.now() - t1).toBeLessThanOrEqual(Math.max(first, 5));
  });

  it('400 file cards across 20 nested zones lay out in under 300ms, all contained', async () => {
    const extra: string[] = [];
    for (let z = 0; z < 20; z++) for (let i = 0; i < 20; i++) extra.push(`libs/z${String(z).padStart(2, '0')}/src/file${i}.ts`);
    const { hierarchy: h, relations } = zoneFixture(extra);
    const cut = computeMapView(h, relations, [], opts({ mode: 'folders', nodeBudget: 2000, expansion: { [expansionKey('project', 'folder:libs')]: true } })).cut!;
    expect(cut.items.filter((i) => i.kind === 'file').length).toBeGreaterThanOrEqual(400);
    await layoutOf(cut); // warm: loads ELK
    clearCutLayoutCache();
    const t = performance.now();
    const pos = await layoutOf(cut);
    expect(performance.now() - t).toBeLessThan(300);
    for (const item of cut.items) if (item.parentId) expect(inside(pos.get(item.id)!, pos.get(item.parentId)!)).toBe(true);
  });
});

describe('packing', () => {
  it('shelfPack and gridPack place every block without overlap', () => {
    const blocks = Array.from({ length: 23 }, (_, i) => ({ id: `b${i}`, w: 100 + (i % 5) * 20, h: 40 + (i % 3) * 15 }));
    for (const packed of [shelfPack(blocks, 10), gridPack(blocks, 10)]) {
      const r = blocks.map((b) => ({ ...packed.at.get(b.id)!, w: b.w, h: b.h }));
      for (let i = 0; i < r.length; i++) {
        expect(r[i].x + r[i].w).toBeLessThanOrEqual(packed.width + 0.5);
        expect(r[i].y + r[i].h).toBeLessThanOrEqual(packed.height + 0.5);
        for (let j = i + 1; j < r.length; j++) expect(overlap(r[i] as BoxPos, r[j] as BoxPos)).toBe(false);
      }
    }
  });
  it('rich cards list at most 8 symbol rows plus a "more" row', () => {
    expect([rowsFor(0), rowsFor(3), rowsFor(8), rowsFor(30)]).toEqual([0, 3, 8, 9]);
  });
});

describe('level of detail', () => {
  it('quantizes zoom, flags the summary tier and counter-scales labels within the room', () => {
    expect(quantizeZoom(0.123)).toBeCloseTo(0.1);
    expect(quantizeZoom(0.001)).toBeCloseTo(0.05);
    expect(isSummaryTier('system')).toBe(true);
    expect(showsSymbolRows('system')).toBe(false);
    expect(showsSymbolRows('detail')).toBe(true);
    expect(labelScale(1, { contentWidth: 100, roomWidth: 400, max: 5 })).toBe(1);
    expect(labelScale(0.2, { contentWidth: 100, roomWidth: 600, max: 5 })).toBe(5);
    expect(labelScale(0.2, { contentWidth: 100, roomWidth: 250, max: 5 })).toBe(2.5);
    expect(labelScale(0.01, { contentWidth: 500, roomWidth: 100, max: 5 })).toBe(1);
  });
});

describe('edge emphasis', () => {
  const node = (id: string, parentId?: string, hidden = false) => ({ id, parentId, hidden, position: { x: 0, y: 0 }, data: {} }) as Node;
  const edge = (id: string, source: string, target: string, layer: string) => ({ id, source, target, data: { layer } }) as unknown as Edge;
  it('summary tier hides portal edges unless focused; hidden ends hide edges', () => {
    const nodes = [node('frame'), node('a', 'frame', true), node('p'), node('q')];
    const edges = [edge('e1', 'frame', 'p', 'portal'), edge('e2', 'q', 'p', 'portal'), edge('e3', 'a', 'q', 'detail'), edge('e4', 'frame', 'q', 'bundle')];
    const out = emphasise(edges, nodes, null, true);
    expect(out.filter((e) => e.hidden).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    const focused = emphasise(edges, nodes, 'frame', true);
    expect(focused.find((e) => e.id === 'e1')!.hidden).toBeFalsy();
    expect(focused.find((e) => e.id === 'e1')!.data).toMatchObject({ hot: true });
  });
  it('a crowd of card-level cross edges shows only for the focus', () => {
    const nodes = [node('f1'), node('f2'), node('c1', 'f1'), node('c2', 'f2')];
    const edges = Array.from({ length: DETAIL_EDGE_LIMIT + 1 }, (_, i) => edge(`d${i}`, 'c1', i === 0 ? 'c2' : 'f2', 'detail'));
    expect(emphasise(edges, nodes, null).every((e) => e.hidden)).toBe(true);
    expect(emphasise(edges.slice(0, 5), nodes, null)).toEqual(edges.slice(0, 5));
    expect(emphasise(edges, nodes, 'f1').every((e) => !e.hidden)).toBe(true);
  });
});

describe('zone overrides', () => {
  it('pure edits drop empty entries', () => {
    let o = renameZone(EMPTY_ZONE_OVERRIDES, 'packages:x', ' Backend ');
    o = recolorZone(o, 'packages:x', -1);
    o = collapseZone(o, 'packages:x', true);
    expect(o.zones['packages:x']).toMatchObject({ name: 'Backend', collapsed: true });
    expect(o.zones['packages:x'].color).toBeGreaterThanOrEqual(0);
    expect(o.zones['packages:x'].color).toBeLessThan(ZONE_COLOR_SLOTS);
    o = renameZone(o, 'packages:x', '  ');
    expect(o.zones['packages:x'].name).toBeUndefined();
    const emptied = collapseZone(renameZone(EMPTY_ZONE_OVERRIDES, 'a:b', 'n'), 'a:b', true);
    expect(Object.keys(renameZone(emptied, 'a:b', '').zones)).toEqual(['a:b']);
    expect(pinFile(EMPTY_ZONE_OVERRIDES, 'a.ts', 'packages:x').pins).toEqual({ 'a.ts': 'packages:x' });
    expect(unpinFile(pinFile(EMPTY_ZONE_OVERRIDES, 'a.ts', 'packages:x'), 'a.ts').pins).toEqual({});
  });

  it('applies an edit at once, keeps the server answer, and rolls back with a notice on failure', async () => {
    const store = createCanvasStore({ projectId: 'p' });
    const seen: string[] = [];
    const ok = { putZoneOverrides: async (o: typeof EMPTY_ZONE_OVERRIDES) => (seen.push(Object.keys(o.pins).join()), { ...o, version: 1 as const }) };
    const p = applyOverrideEdit(store, ok, (o) => pinFile(o, 'a.ts', 'packages:x'));
    expect(store.getState().zoneOverrides.pins).toEqual({ 'a.ts': 'packages:x' }); // optimistic
    await p;
    expect(seen).toEqual(['a.ts']);
    expect(store.getState().zoneNotice).toBeNull();

    const bad = { putZoneOverrides: async () => Promise.reject(new Error('HTTP 404')) };
    await applyOverrideEdit(store, bad as never, (o) => pinFile(o, 'b.ts', 'packages:y'));
    expect(store.getState().zoneOverrides.pins).toEqual({ 'a.ts': 'packages:x' }); // rolled back
    expect(store.getState().zoneNotice).toMatch(/HTTP 404.*undone/);
  });
});
