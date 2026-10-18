import { describe, it, expect, beforeEach } from 'vitest';
import { computeForceLayout, hasOverlap, separateRects } from '../../../src/canvas/layout/force-layout.js';
import { computeLayout, layoutModeFor } from '../../../src/canvas/layout/compute-layout.js';
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

  it('ELK layout (file/symbol views) packs nodes without overlap', async () => {
    const nodes = boxes.map((b) => ({ id: b.id, position: { x: 0, y: 0 }, data: {}, style: { width: b.width, height: b.height } })) as Node[];
    const pos = await computeLayout(nodes, links, 'layered');
    expect(hasOverlap(rects(pos))).toBe(false);
  });

  it('chooses force for overview levels and layered once files are shown', () => {
    expect(layoutModeFor([])).toBe('force');
    expect(layoutModeFor(['system:src'])).toBe('force');
    expect(layoutModeFor(['system:src', 'module:src/api'])).toBe('layered');
  });
});

describe('canvas store (implements contracts/canvas/state.ts)', () => {
  beforeEach(() => useCanvasStore.setState({ drillPath: [], selectedNodeId: null, focusRequest: null, activeOverlay: null }));

  it('navigateTo drills, selects, requests focus and optionally sets the overlay', () => {
    const s = useCanvasStore.getState();
    s.navigateTo({ drillPath: ['system:src', 'module:src/api'], nodeId: 'file:src/api/a.ts', overlay: 'cycles' });
    const first = useCanvasStore.getState();
    expect(first).toMatchObject({ drillPath: ['system:src', 'module:src/api'], selectedNodeId: 'file:src/api/a.ts', activeOverlay: 'cycles' });
    s.navigateTo({ drillPath: [], nodeId: 'system:src' });
    const second = useCanvasStore.getState();
    expect(second.activeOverlay).toBe('cycles'); // undefined overlay keeps the current one
    expect(second.focusRequest!.seq).toBeGreaterThan(first.focusRequest!.seq);
  });

  it('drillToLevel truncates and -1 returns to the root', () => {
    const s = useCanvasStore.getState();
    s.setDrillPath(['system:src', 'module:src/api', 'file:src/api/a.ts']);
    s.drillToLevel(0);
    expect(useCanvasStore.getState().drillPath).toEqual(['system:src']);
    s.drillToLevel(-1);
    expect(useCanvasStore.getState().drillPath).toEqual([]);
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
