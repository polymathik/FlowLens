import { describe, expect, it } from 'vitest';
import type { HistoryTopology } from '../../../src/contracts/history.js';
import { PROJECT_NODE_ID } from '../../../src/contracts/hierarchy.js';
import { computeMapView } from '../../../src/canvas/utils/map-view';
import { buildItemMap } from '../../../src/canvas/timeline/items';
import { buildLives } from '../../../src/canvas/timeline/lives';
import { ghostPaths, withGhosts } from '../../../src/canvas/timeline/ghost-hierarchy';
import { aliveEdges, indexTopology, linkDiff, sampleFor } from '../../../src/canvas/timeline/topo';
import { chartSeries, growthOf, MAX_SERIES, MORE_KEY, MORE_LABEL, OTHER_LABEL, outsideOf, stackPaths } from '../../../src/canvas/timeline/chart-model';
import { axisPositions } from '../../../src/canvas/timeline/scrub-math';
import { createTimelineStore } from '../../../src/canvas/timeline/timeline-store';
import { historyOf, STORY } from '../helpers/history-fixture';
import { zoneFixture } from '../helpers/zone-fixture';

const { hierarchy: today } = zoneFixture();
const history = historyOf(STORY);
const lives = buildLives(history);
const h = withGhosts(today, ghostPaths(today, lives).paths);
const view = computeMapView(h, [], [], { showLockfiles: false, zones: { mode: 'packages', expansion: {} } });
const items = buildItemMap(view.cut!, h);

const sha = (i: number) => history.commits[i].sha;
const topology: HistoryTopology = {
  version: 1, head: sha(7), every: 3, capped: false, skipped: [], built_at: '2026-02-01T00:00:00Z', filter_key: 'k',
  files: ['apps/web/src/app.ts', 'packages/core/src/ids.ts', 'packages/server/src/a.ts', 'packages/server/src/b.ts'],
  samples: [
    { sha: sha(0), date: history.commits[0].date, files: [1, 2], edges: [[2, 1, 1]] },
    { sha: sha(3), date: history.commits[3].date, files: [0, 1, 2, 3], edges: [[2, 1, 1], [3, 1, 2], [0, 1, 1]] },
    { sha: sha(7), date: history.commits[7].date, files: [0, 1, 2, 3], edges: [[3, 1, 2], [0, 1, 1]] },
  ],
};

describe('link history on the map', () => {
  const ti = indexTopology(history, topology);
  it('maps samples to commits and finds the newest sample at or before a commit', () => {
    expect(ti.commit).toEqual([0, 3, 7]);
    expect(sampleFor(ti, 0)).toBe(0);
    expect(sampleFor(ti, 2)).toBe(0);
    expect(sampleFor(ti, 3)).toBe(1);
    expect(sampleFor(ti, 99)).toBe(2);
    expect(sampleFor({ commit: [4], pos: [0] }, 2)).toBeNull();
  });
  it('ignores samples whose commit is outside the loaded window', () => {
    const t = { ...topology, samples: [{ ...topology.samples[0], sha: 'f'.repeat(40) }, topology.samples[2]] };
    expect(indexTopology(history, t).commit).toEqual([7]);
  });
  it('finds every displayed edge of a sample by source>target, at card, sibling and frame level, summing weights', () => {
    const w = aliveEdges(topology, 1, items);
    expect(w.get('package:packages/server>package:packages/core')).toBe(3); // a.ts→ids (1) + b.ts→ids (2)
    expect(w.get('package:packages/server>package:packages/server')).toBeUndefined();
    const web = [...w.keys()].find((k) => k.endsWith('>package:packages/core') && !k.startsWith('package:packages/server'));
    expect(web).toBeDefined();
  });
  it('counts added and removed links between two commits from their samples', () => {
    expect(linkDiff(topology, ti, 0, 7)).toMatchObject({ added: 2, removed: 1, from: 0, to: 2 });
    const d = linkDiff(topology, ti, 3, 7)!;
    expect(d).toMatchObject({ added: 0, removed: 1 });
    expect(linkDiff(topology, ti, 3, 4)!).toMatchObject({ added: 0, removed: 0, from: 1, to: 1 }); // same sample: nothing known
    expect(linkDiff(topology, { commit: [5], pos: [0] }, 1, 7)).toBeNull();
  });
});

describe('growth chart data', () => {
  const growth = growthOf(history, items);
  it('books growth to the top-level zones of the map and the rest to "Other files"', () => {
    const series = chartSeries(growth, items, 'files');
    const labels = series.map((s) => s.label);
    expect(labels).toContain('@h/server');
    expect(labels).toContain('@h/core');
    const total = series.reduce((sum, s) => sum + s.values[7], 0);
    expect(total).toBe(growth.total.files[7]);
    expect(growth.total.files[7]).toBe(6); // ids, index, a (renamed), b, app, docs/tool
  });
  it('orders the biggest zone first (bottom of the stack) and uses the zone hue', () => {
    const series = chartSeries(growth, items, 'files');
    const last = series.map((s) => s.values[7]);
    expect(last).toEqual([...last].sort((a, b) => b - a).filter((_, i, arr) => i < arr.length) as number[]);
    for (const s of series) if (s.key !== null) expect(s.hue).toBe(items.byId.get(s.key)!.colorIndex);
  });
  it('merges the smallest zones into one series past MAX_SERIES, keeping the totals', () => {
    const many = historyOf([Array.from({ length: 20 }, (_, i) => ['A', `pkg${i}/f.ts`] as [string, string])] as never);
    const zoneOf = (p: string) => p.split('/')[0];
    const fake = { zones: [...new Set(many.commits[0].files.map((f) => zoneOf(f.path)))].map((z) => ({ zone: z, files: [1], ghosts: [0], loc: [10] })), total: { zone: null, files: [20], ghosts: [0], loc: [200] }, length: 1 };
    const fakeItems = { byId: new Map(fake.zones.map((z, i) => [z.zone!, { label: z.zone!, colorIndex: i % 6 }])) } as never;
    const series = chartSeries(fake as never, fakeItems, 'files');
    expect(series).toHaveLength(MAX_SERIES);
    expect(series.at(-1)!.label).toBe(MORE_LABEL);
    expect(series.at(-1)!.key).toBe(MORE_KEY);
    expect(series.reduce((s, x) => s + x.values[0], 0)).toBe(20);
    expect(OTHER_LABEL).not.toBe(MORE_LABEL);
  });
  it('keeps the files no zone claims apart from the merged smaller zones', () => {
    const zones = Array.from({ length: 12 }, (_, i) => ({ zone: `z${i}`, files: [12 - i], ghosts: [0], loc: [1] }));
    const fake = { zones: [...zones, { zone: null, files: [30], ghosts: [0], loc: [1] }], total: { zone: null, files: [108], ghosts: [0], loc: [13] }, length: 1 };
    const fakeItems = { byId: new Map(zones.map((z, i) => [z.zone, { label: z.zone, colorIndex: i % 6 }])) } as never;
    const series = chartSeries(fake as never, fakeItems, 'files');
    expect(series).toHaveLength(MAX_SERIES);
    expect(series.at(-1)).toMatchObject({ key: null, label: OTHER_LABEL });
    expect(series.at(-2)).toMatchObject({ key: MORE_KEY, label: MORE_LABEL });
    expect(series.reduce((s, x) => s + x.values[0], 0)).toBe(108);
  });
  it('leaves the files outside the view out of the stack when they are most of the repository (drilled in)', () => {
    const zones = [{ zone: 'a', files: [4], ghosts: [0], loc: [40] }, { zone: null, files: [96], ghosts: [0], loc: [960] }];
    const fake = { zones, total: { zone: null, files: [100], ghosts: [0], loc: [1000] }, length: 1 };
    const fakeItems = { byId: new Map([['a', { label: 'a', colorIndex: 0 }]]) } as never;
    expect(outsideOf(fake as never, 'files')).toEqual([96]);
    expect(chartSeries(fake as never, fakeItems, 'files').map((s) => s.label)).toEqual(['a']);
    const few = { ...fake, zones: [{ zone: 'a', files: [95], ghosts: [0], loc: [1] }, { zone: null, files: [5], ghosts: [0], loc: [1] }] };
    expect(outsideOf(few as never, 'files')).toBeNull();
    expect(chartSeries(few as never, fakeItems, 'files').map((s) => s.label)).toEqual(['a', OTHER_LABEL]);
  });
  it('draws a closed polygon per series inside the box, at most maxPoints points, scaled to the largest total', () => {
    const series = chartSeries(growth, items, 'loc');
    const pos = axisPositions(history.commits, 'time');
    const { paths, yMax } = stackPaths(series, pos, 400, 100, 300);
    expect(paths).toHaveLength(series.length);
    expect(yMax).toBe(Math.max(...growth.total.loc));
    for (const p of paths) {
      expect(p.d.startsWith('M')).toBe(true);
      expect(p.d.endsWith('Z')).toBe(true);
      const ys = [...p.d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.01);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100.01);
    }
    expect(stackPaths([], pos, 400, 100, 300).paths).toEqual([]);
    const long = Array.from({ length: 5000 }, (_, i) => i / 4999);
    const s2 = { key: 'a', label: 'a', hue: 0, values: long.map((_, i) => i) };
    const pts = stackPaths([s2], long, 600, 90, 300).paths[0].d.split('L').length;
    expect(pts).toBeLessThan(2 * 301 + 2);
  });
});

describe('timeline store', () => {
  it('records the previous playhead on every move and ignores no-ops', () => {
    const store = createTimelineStore();
    store.getState().setHistory(history);
    expect(store.getState()).toMatchObject({ index: 7, prev: 7 });
    store.getState().seek(2);
    expect(store.getState()).toMatchObject({ index: 2, prev: 7 });
    store.getState().step(1);
    expect(store.getState()).toMatchObject({ index: 3, prev: 2 });
    const before = store.getState();
    store.getState().seek(3);
    expect(store.getState()).toBe(before);
    store.getState().seek(-9);
    expect(store.getState().index).toBe(0);
    store.getState().seek(99);
    expect(store.getState().index).toBe(7);
  });
  it('keeps the playhead at the newest commit when new commits arrive, and clamps otherwise', () => {
    const store = createTimelineStore();
    store.getState().setHistory(history);
    store.getState().setHistory(historyOf([...STORY, [['M', 'docs/tool.ts']]]));
    expect(store.getState().index).toBe(8);
    store.getState().seek(2);
    store.getState().setHistory(historyOf([...STORY, [['M', 'docs/tool.ts']], [['M', 'docs/tool.ts']]]));
    expect(store.getState().index).toBe(2);
  });
  it('plays from the start when the playhead sits at the newest commit, and not with a single commit', () => {
    const store = createTimelineStore();
    store.getState().setHistory(history);
    store.getState().play();
    expect(store.getState()).toMatchObject({ playing: true, index: 0, prev: 0 });
    store.getState().pause();
    store.getState().seek(4);
    store.getState().play();
    expect(store.getState().index).toBe(4);
    const one = createTimelineStore();
    one.getState().setHistory(historyOf([[['A', 'a.ts']]]));
    one.getState().play();
    expect(one.getState().playing).toBe(false);
  });
  it('closing stops playback and clears the compare marker; the mode switch reloads', () => {
    const store = createTimelineStore();
    store.getState().setHistory(history);
    store.getState().setOpen(true);
    store.getState().setCompareFrom(3);
    store.getState().play();
    store.getState().setOpen(false);
    expect(store.getState()).toMatchObject({ playing: false, compareFrom: null });
    store.getState().setMainline(false);
    expect(store.getState()).toMatchObject({ mainline: false, history: null, load: { status: 'loading' } });
  });
});

describe('guards', () => {
  it('PROJECT_NODE_ID is the root the ghost folder hangs from', () => {
    expect(h.nodes.get(PROJECT_NODE_ID)!.childIds.some((id) => id.startsWith('folder:__deleted__'))).toBe(true);
  });
});
