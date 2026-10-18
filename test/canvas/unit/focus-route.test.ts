import { describe, it, expect } from 'vitest';
import { buildCanvasHash, parseCanvasHash } from '../../../src/canvas/router/hash-route';
import { buildExplorerHash, mapRouteKey, parseExplorerHash } from '../../../src/canvas/router/explorer-route';
import { focusSpecOfRoute, routeFocusOfSpec } from '../../../src/canvas/router/useFocusUrl';
import { focusIdOf, focusSpecFor } from '../../../src/canvas/focus/focus-actions';
import { emphasiseFocus, pathPairs } from '../../../src/canvas/focus/focus-emphasis';
import { computeFocusView } from '../../../src/canvas/focus/focus-view';
import { createCanvasStore } from '../../../src/canvas/store/canvas-store';
import { F, zoneFixture } from '../helpers/zone-fixture';

describe('focus deep links', () => {
  it('parse and build round-trip, with defaults left out', () => {
    const route = parseCanvasHash('#/p/abc/focus/packages%2Fcore%2Fsrc%2Fadapter.ts?depth=3&dir=in&types=import,call&lateral=1');
    expect(route).toEqual({ projectId: 'abc', focus: { id: 'packages/core/src/adapter.ts', depth: 3, dir: 'in', types: ['import', 'call'], lateral: true } });
    expect(buildCanvasHash(route)).toBe('#/p/abc/focus/packages%2Fcore%2Fsrc%2Fadapter.ts?depth=3&dir=in&types=import,call&lateral=1');
    expect(parseCanvasHash('#/p/abc/focus/x.ts').focus).toEqual({ id: 'x.ts' });
    expect(parseCanvasHash('#/p/abc/focus/x.ts?depth=zero&dir=sideways&types=nonsense').focus).toEqual({ id: 'x.ts' });
  });

  it('the explorer route is a map route with a focus, and its key changes with every focus setting', () => {
    const hash = '#/p/abc/map/focus/zone%3Alayers%3AServices?depth=2&dir=both';
    const route = parseExplorerHash(hash);
    expect(route).toMatchObject({ tab: 'project', projectId: 'abc', view: 'map', focus: { id: 'zone:layers:Services', depth: 2, dir: 'both' } });
    expect(buildExplorerHash(route)).toBe(hash);
    const other = parseExplorerHash('#/p/abc/map/focus/zone%3Alayers%3AServices?depth=3&dir=both');
    expect(mapRouteKey(route)).not.toBe(mapRouteKey(other));
    expect(parseExplorerHash('#/p/abc/map/path/src')).not.toHaveProperty('focus');
  });

  it('a route becomes a spec and back', () => {
    const f = { id: 'a.ts', depth: 1, dir: 'out' as const, types: ['call' as const] };
    expect(routeFocusOfSpec(focusSpecOfRoute(f))).toEqual(f);
    expect(focusSpecOfRoute({ id: 'a.ts' })).toEqual({ id: 'a.ts', depth: 2, direction: 'both' });
  });
});

describe('focus actions, store and hover paths', () => {
  const fx = zoneFixture();
  const h = fx.hierarchy;

  it('ids: files and folders are focused by path, symbols by qualified name, zones by zone id; stand-in cards cannot be focused', () => {
    expect(focusIdOf(h, 'file:packages/core/src/adapter.ts')).toBe('packages/core/src/adapter.ts');
    expect(focusIdOf(h, 'package:packages/core')).toBe('packages/core');
    expect(focusIdOf(h, 'zone:layers:Core')).toBe('zone:layers:Core');
    expect(focusIdOf(h, 'zone:focus:self')).toBeNull();
    expect(focusIdOf(h, 'zone:focus:more:zone:folders:x')).toBeNull();
    expect(focusIdOf(h, 'project')).toBeNull();
    expect(focusIdOf(h, 'file:nope.ts')).toBeNull();
  });

  it('a new focus keeps the depth, direction and types of the current one', () => {
    const cur = { id: 'a', depth: 3, direction: 'in' as const, types: ['call' as const] };
    expect(focusSpecFor(h, 'file:docs/tool.ts', cur)).toEqual({ id: 'docs/tool.ts', depth: 3, direction: 'in', types: ['call'] });
    expect(focusSpecFor(h, 'file:docs/tool.ts', null)).toEqual({ id: 'docs/tool.ts', depth: 2, direction: 'both' });
  });

  it('the store enters and leaves focus without touching the drill path or the selection of the view it returns to', () => {
    const store = createCanvasStore();
    store.getState().setDrillPath(['package:packages/core']);
    store.getState().selectNode('file:packages/core/src/ids.ts');
    store.getState().setFocus({ id: 'docs/tool.ts', depth: 2, direction: 'both' });
    expect(store.getState().focus?.id).toBe('docs/tool.ts');
    expect(store.getState().selectedNodeId).toBeNull();
    expect(store.getState().drillPath).toEqual(['package:packages/core']);
    store.getState().setFocus(null);
    expect(store.getState().focus).toBeNull();
    expect(store.getState().drillPath).toEqual(['package:packages/core']);
  });

  it('a jump (search, portal, deep link) leaves focus mode', () => {
    const store = createCanvasStore();
    store.getState().setFocus({ id: 'docs/tool.ts', depth: 2, direction: 'both' });
    store.getState().navigateTo({ drillPath: ['package:packages/core'], nodeId: 'file:packages/core/src/ids.ts' });
    expect(store.getState().focus).toBeNull();
    expect(store.getState().selectedNodeId).toBe('file:packages/core/src/ids.ts');
  });

  it('hover paths: every shortest path from the focus to a far card, as item pairs', () => {
    const v = computeFocusView(h, fx.relations, F('packages/core/src/adapter.ts'), { depth: 2, direction: 'in' }, { showLockfiles: false, zones: { mode: 'packages', expansion: {} } });
    const f = { info: v.focus!, atomOfFile: v.cut!.atomOfFile };
    const cli = 'file:packages/server/src/cli.ts';
    const pairs = pathPairs(f, cli)!;
    expect([...pairs].sort()).toEqual([
      `file:packages/core/src/adapter.ts|file:packages/server/src/adapters/codex/codex.ts`,
      `file:packages/server/src/adapters/codex/codex.ts|file:packages/core/src/adapter.ts`,
      `file:packages/server/src/adapters/codex/codex.ts|${cli}`,
      `${cli}|file:packages/server/src/adapters/codex/codex.ts`,
    ].sort());
    expect(pathPairs(f, 'file:packages/core/src/adapter.ts')).toBeNull(); // the focus itself has no path
    const edge = (source: string, target: string) => ({ id: `${source}>${target}`, source, target, data: { count: 1, types: [], layer: 'focus' as const } });
    const edges = [edge('file:packages/server/src/cli.ts', 'file:packages/server/src/adapters/codex/codex.ts'), edge('file:packages/server/src/a.ts', 'file:packages/core/src/adapter.ts')];
    const out = emphasiseFocus(edges as never, [], cli, f, false);
    expect(out[0].data?.onPath).toBe(true);
    expect(out[1].data?.onPath).toBeUndefined();
  });
});
