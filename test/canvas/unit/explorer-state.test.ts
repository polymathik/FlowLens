import { describe, it, expect } from 'vitest';
import { createCanvasStore } from '../../../src/canvas/store/canvas-store.js';
import { dropProjectStore, getProjectStore } from '../../../src/canvas/store/project-stores.js';
import { loadPersistedTabs, savePersistedTabs } from '../../../src/canvas/store/explorer-store.js';
import { markApplied, setPendingHighlight, takePendingHighlight, wasApplied } from '../../../src/canvas/router/map-intents.js';
import { findingHighlightIds, showOnMapHash } from '../../../src/canvas/components/explorer/health-nav.js';
import { sortWorstFirst } from '../../../src/canvas/components/explorer/home-sort.js';
import { TABS_STORAGE_KEY } from '../../../src/contracts/canvas/explorer.js';
import type { HealthFinding } from '../../../src/contracts/health.js';
import type { ProjectDetail } from '../../../src/contracts/service.js';

describe('per-project canvas stores', () => {
  it('keeps drill path, overlay, selection, filters and search separate per project', () => {
    const a = getProjectStore('A');
    const b = getProjectStore('B');
    a.getState().navigateTo({ drillPath: ['system:src'], nodeId: 'file:src/x.ts', overlay: 'cycles', highlight: ['file:src/x.ts'] });
    a.getState().toggleRelationType('import');
    a.getState().setSearchOpen(true);
    a.getState().setSearch('foo');
    const sb = b.getState();
    expect(sb.drillPath).toEqual([]);
    expect(sb.activeOverlay).toBeNull();
    expect(sb.selectedNodeId).toBeNull();
    expect(sb.highlightedIds).toEqual([]);
    expect(sb.visibleRelationTypes.has('import')).toBe(true);
    expect(sb.searchQuery).toBe('');
    expect(a.getState().highlightedIds).toEqual(['file:src/x.ts']);
    expect(getProjectStore('A')).toBe(a); // same store when the tab comes back
    dropProjectStore('A');
    expect(getProjectStore('A')).not.toBe(a); // closed tab starts fresh
  });

  it('clearing the selection clears highlights; a new jump replaces them', () => {
    const s = createCanvasStore();
    s.getState().navigateTo({ drillPath: [], nodeId: 'n', highlight: ['n', 'm'] });
    s.getState().navigateTo({ drillPath: [], nodeId: 'k' });
    expect(s.getState().highlightedIds).toEqual([]);
    s.getState().setHighlighted(['x']);
    s.getState().selectNode(null);
    expect(s.getState().highlightedIds).toEqual([]);
  });
});

describe('tab persistence', () => {
  it('round-trips through storage and ignores junk', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePersistedTabs(['a', 'b'], storage);
    expect(loadPersistedTabs(storage)).toEqual(['a', 'b']);
    mem.set(TABS_STORAGE_KEY, '{"version":2,"open":["x"]}');
    expect(loadPersistedTabs(storage)).toEqual([]);
    mem.set(TABS_STORAGE_KEY, 'not json');
    expect(loadPersistedTabs(storage)).toEqual([]);
  });

  it('never throws when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(loadPersistedTabs(blocked)).toEqual([]);
    expect(() => savePersistedTabs(['a'], blocked)).not.toThrow();
  });
});

describe('Show on map hand-off', () => {
  const finding = {
    focus: { kind: 'file', identifier: 'src/ui/view.ts', overlay: 'cycles', entity_ids: ['e1'], files: ['src/ui/view.ts', 'src/ui/widgets.ts'], project_id: 'P', url: '' },
  } as unknown as HealthFinding;

  it('builds the map route and queues highlights for exactly that route', () => {
    expect(findingHighlightIds(finding)).toEqual(['e1', 'file:src/ui/view.ts', 'file:src/ui/widgets.ts']);
    const hash = showOnMapHash('P', finding);
    expect(hash).toBe('#/p/P/map/file/src%2Fui%2Fview.ts?overlay=cycles');
    expect(takePendingHighlight('P', 'other')).toBeUndefined();
    expect(takePendingHighlight('P', 'file:src/ui/view.ts?cycles')).toEqual(findingHighlightIds(finding));
    expect(takePendingHighlight('P', 'file:src/ui/view.ts?cycles')).toBeUndefined(); // consumed
  });

  it('applies a route once per navigation stamp', () => {
    setPendingHighlight('Q', 'k', []);
    expect(wasApplied('Q', 'k', 1)).toBe(false);
    markApplied('Q', 'k', 1);
    expect(wasApplied('Q', 'k', 1)).toBe(true);
    expect(wasApplied('Q', 'k', 2)).toBe(false);
  });
});

describe('Home order', () => {
  it('puts the lowest score first, unscored next, missing last', () => {
    const p = (id: string, status: 'ok' | 'missing' = 'ok') => ({ id, name: id, status }) as ProjectDetail;
    const s = (score: number) => ({ score }) as never;
    const out = sortWorstFirst([p('m', 'missing'), p('good'), p('bad'), p('pending')], { good: s(95), bad: s(41) });
    expect(out.map((x) => x.id)).toEqual(['bad', 'good', 'pending', 'm']);
  });
});
