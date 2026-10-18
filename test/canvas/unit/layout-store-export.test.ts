import { describe, it, expect, beforeEach } from 'vitest';
import { computeForceLayout, hasOverlap, separateRects } from '../../../src/canvas/layout/force-layout.js';
import { computeLayout, sortForLayout } from '../../../src/canvas/layout/compute-layout.js';
import { computeExportFrame } from '../../../src/canvas/utils/export-utils.js';
import { useCanvasStore } from '../../../src/canvas/store/canvas-store.js';
import { formatRelativeTime } from '../../../src/canvas/utils/format.js';
import type { Node } from '@xyflow/react';

const boxes = Array.from({ length: 24 }, (_, i) => ({ id: `n${i}`, width: 180, height: 60 }));
const links = boxes.slice(1).map((b, i) => ({ source: `n${i % 5}`, target: b.id }));
const rects = (pos: Map<string, { x: number; y: number }>) => boxes.map((b) => ({ ...pos.get(b.id)!, width: b.width, height: b.height }));

describe('layout', () => {
  it('force layout never overlaps boxes and is deterministic', () => {
    const a = computeForceLayout(boxes, links);
    expect(hasOverlap(rects(a))).toBe(false);
    expect([...computeForceLayout(boxes, links).entries()]).toEqual([...a.entries()]);
  });

  it('separateRects pushes coincident boxes apart', () => {
    const r = [0, 1, 2].map(() => ({ x: 0, y: 0, width: 100, height: 40 }));
    separateRects(r);
    expect(hasOverlap(r)).toBe(false);
  });

  it('container layout: connected nodes via ELK, the rest in a sorted grid below, no overlap', async () => {
    const nodes = boxes.map((b, i) => ({ id: b.id, type: i % 2 ? 'file' : 'folder', position: { x: 0, y: 0 }, data: { label: b.id }, width: b.width, height: b.height })) as Node[];
    const connectedLinks = links.slice(0, 8); // n0..n4 -> n1..n8; the other nodes stay loose
    const pos = await computeLayout(nodes, connectedLinks);
    expect(hasOverlap(rects(pos))).toBe(false);
    const linked = new Set(connectedLinks.flatMap((l) => [l.source, l.target]));
    const loose = nodes.filter((n) => !linked.has(n.id));
    const linkedBottom = Math.max(...[...linked].map((id) => pos.get(id)!.y + 60));
    expect(Math.min(...loose.map((n) => pos.get(n.id)!.y))).toBeGreaterThanOrEqual(linkedBottom);
  });

  it('is deterministic whatever the input order, and edge-less sets become a name-sorted grid', async () => {
    const nodes = boxes.slice(0, 7).map((b) => ({ id: b.id, type: 'file', position: { x: 0, y: 0 }, data: { label: b.id }, width: 180, height: 60 })) as Node[];
    const a = await computeLayout(nodes, []);
    const b = await computeLayout([...nodes].reverse(), []);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    expect(sortForLayout([...nodes].reverse()).map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    const ys = new Set([...a.values()].map((p) => p.y));
    expect(ys.size).toBeGreaterThan(1); // a grid, not one long row
  });

  it('pins incoming portals before and outgoing portals after the content', async () => {
    const mk = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data }, width: 200, height: 60 }) as Node;
    const nodes = [mk('out', 'portal', { direction: 'out' }), mk('mid', 'file'), mk('in', 'portal', { direction: 'in' })];
    const pos = await computeLayout(nodes, [{ source: 'in', target: 'mid' }, { source: 'mid', target: 'out' }]);
    expect(pos.get('in')!.x).toBeLessThan(pos.get('mid')!.x);
    expect(pos.get('mid')!.x).toBeLessThan(pos.get('out')!.x);
  });
});

describe('canvas store (implements contracts/canvas/state.ts)', () => {
  beforeEach(() => useCanvasStore.setState({ drillPath: [], selectedNodeId: null, focusRequest: null, activeOverlay: null }));

  it('navigateTo drills, selects, requests focus and optionally sets the overlay', () => {
    const s = useCanvasStore.getState();
    s.navigateTo({ drillPath: ['folder:src', 'folder:src/api'], nodeId: 'file:src/api/a.ts', overlay: 'cycles' });
    const first = useCanvasStore.getState();
    expect(first).toMatchObject({ drillPath: ['folder:src', 'folder:src/api'], selectedNodeId: 'file:src/api/a.ts', activeOverlay: 'cycles' });
    s.navigateTo({ drillPath: [], nodeId: 'folder:src' });
    const second = useCanvasStore.getState();
    expect(second.activeOverlay).toBe('cycles'); // undefined overlay keeps the current one
    expect(second.focusRequest!.seq).toBeGreaterThan(first.focusRequest!.seq);
  });

  it('drillToLevel truncates and -1 returns to the root', () => {
    const s = useCanvasStore.getState();
    s.setDrillPath(['folder:src', 'folder:src/api', 'file:src/api/a.ts', 'sym1', 'sym2']);
    s.drillToLevel(1);
    expect(useCanvasStore.getState().drillPath).toEqual(['folder:src', 'folder:src/api']);
    s.drillToLevel(-1);
    expect(useCanvasStore.getState().drillPath).toEqual([]);
  });

  it('opening a container (nodeId null) selects nothing and requests no focus', () => {
    const s = useCanvasStore.getState();
    s.navigateTo({ drillPath: ['folder:src'], nodeId: null });
    expect(useCanvasStore.getState()).toMatchObject({ drillPath: ['folder:src'], selectedNodeId: null, focusRequest: null });
  });

  it('closing search clears the query', () => {
    const s = useCanvasStore.getState();
    s.setSearchOpen(true);
    s.setSearch('abc');
    s.setSearchOpen(false);
    expect(useCanvasStore.getState()).toMatchObject({ searchOpen: false, searchQuery: '' });
  });
});

describe('export frame', () => {
  it('frames the node bounds with a margin and a minimum size', () => {
    const f = computeExportFrame({ x: 100, y: 50, width: 1200, height: 600 });
    expect(f.width).toBe(1328);
    expect(f.height).toBe(728);
    // Node bounds map inside the image.
    const left = 100 * f.viewport.zoom + f.viewport.x;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(computeExportFrame({ x: 0, y: 0, width: 10, height: 10 })).toMatchObject({ width: 640, height: 400 });
  });
});

describe('formatRelativeTime', () => {
  it('renders plain-language ages', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(formatRelativeTime(null, now)).toBe('never');
    expect(formatRelativeTime('2026-10-18T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-18T11:30:00Z', now)).toBe('30 min ago');
    expect(formatRelativeTime('2026-10-15T12:00:00Z', now)).toBe('3 days ago');
  });
});
