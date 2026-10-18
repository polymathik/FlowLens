import { describe, it, expect } from 'vitest';
import { buildCanvasUrl } from '../../../src/contracts/canvas-links.js';
import { buildCanvasHash, parseCanvasHash } from '../../../src/canvas/router/hash-route';
import { buildExplorerHash, mapRouteKey, parseExplorerHash } from '../../../src/canvas/router/explorer-route';
import { flowSpecOfRoute, parseSpan, routeFlowOfSpec, sameFlowSpec } from '../../../src/canvas/flow/flow-route';
import { createCanvasStore } from '../../../src/canvas/store/canvas-store';

describe('flow deep links', () => {
  it('parse and build round-trip, defaults left out', () => {
    const hash = '#/p/abc/flow/halcyon%2Fapp.ts%2FcreateApp?depth=3&span=112-123&dir=in&follow=call,create,use&max=60&tests=1';
    const route = parseCanvasHash(hash);
    expect(route).toEqual({
      projectId: 'abc',
      flow: { id: 'halcyon/app.ts/createApp', depth: 3, span: { from: 112, to: 123 }, dir: 'in', follow: ['call', 'create', 'use'], max: 60, tests: true },
    });
    expect(buildCanvasHash(route)).toBe(hash);
    expect(parseCanvasHash('#/p/abc/flow/x').flow).toEqual({ id: 'x' });
    // the defaults are not written: direction out, follow call+create, max 150
    expect(buildCanvasHash({ projectId: 'abc', flow: { id: 'x', dir: 'out', follow: ['create', 'call'], max: 150 } })).toBe('#/p/abc/flow/x');
  });

  it('ignores invalid values instead of failing', () => {
    expect(parseCanvasHash('#/p/abc/flow/x?depth=zero&span=9-3&dir=up&follow=nonsense&max=-1&tests=2').flow).toEqual({ id: 'x' });
    expect(parseCanvasHash('#/p/abc/flow/x?depth=99').flow).toEqual({ id: 'x', depth: 5 });
    expect(parseCanvasHash('#/p/abc/flow/x?max=9999').flow).toEqual({ id: 'x', max: 150 });
    expect(parseSpan('3-9')).toEqual({ from: 3, to: 9 });
    expect(parseSpan('9')).toBeUndefined();
    expect(parseCanvasHash('#/p/abc/flow').flow).toBeUndefined();
  });

  it('reads the link the backend writes (trace_flow canvas_url): id and depth, and an inline handler span', () => {
    const url = buildCanvasUrl({ kind: 'flow', identifier: 'ab12cd', projectId: 'proj1', params: { depth: 4, span: '112-123' }, baseUrl: 'http://127.0.0.1:4280' });
    expect(url).toBe('http://127.0.0.1:4280/#/p/proj1/map/flow/ab12cd?depth=4&span=112-123');
    const route = parseExplorerHash(url.slice(url.indexOf('#')));
    expect(route).toMatchObject({ tab: 'project', projectId: 'proj1', view: 'map', flow: { id: 'ab12cd', depth: 4, span: { from: 112, to: 123 } } });
    expect(flowSpecOfRoute((route as { flow: never }).flow)).toEqual({ id: 'ab12cd', depth: 4, direction: 'out', span: { from: 112, to: 123 } });
  });

  it('the explorer hash is a map route: parse → build is stable (also for ids with slashes and spaces)', () => {
    for (const hash of [
      '#/p/abc/map/flow/GET%20%2Fapi%2Fusers?depth=4',
      '#/p/abc/map/flow/id1?depth=2&dir=in&max=25',
      '#/p/abc/map/flow/id1?depth=5&span=1-9&follow=call,create,use,throw&tests=1',
    ]) {
      const route = parseExplorerHash(hash);
      expect(route).toMatchObject({ tab: 'project', projectId: 'abc', view: 'map' });
      expect(buildExplorerHash(route)).toBe(hash);
    }
    expect(parseExplorerHash('#/p/abc/map/flow/GET%20%2Fapi%2Fusers').flow?.id).toBe('GET /api/users');
    expect(parseExplorerHash('#/p/abc/map/path/src')).not.toHaveProperty('flow');
  });

  it('the route key changes with every setting, so back and forward re-apply the right flow', () => {
    const key = (h: string) => mapRouteKey(parseExplorerHash(h));
    const base = key('#/p/abc/map/flow/x?depth=4');
    expect(base).not.toBeNull();
    for (const other of ['#/p/abc/map/flow/x?depth=3', '#/p/abc/map/flow/y?depth=4', '#/p/abc/map/flow/x?depth=4&dir=in', '#/p/abc/map/flow/x?depth=4&span=1-2', '#/p/abc/map/flow/x?depth=4&max=25', '#/p/abc/map/flow/x?depth=4&tests=1', '#/p/abc/map/flow/x?depth=4&follow=call']) {
      expect(key(other)).not.toBe(base);
    }
    expect(key('#/p/abc/map/flow/x?depth=4&dir=out')).toBe(base);
  });

  it('a spec becomes a link and back (the label is not part of the link)', () => {
    const spec = { id: 'e1', depth: 3, direction: 'in' as const, span: { from: 5, to: 9 }, maxNodes: 50, includeTests: true, label: 'GET /x' };
    const back = flowSpecOfRoute(routeFlowOfSpec(spec));
    expect(back).toEqual({ id: 'e1', depth: 3, direction: 'in', span: { from: 5, to: 9 }, maxNodes: 50, includeTests: true });
    expect(sameFlowSpec(spec, back)).toBe(true);
    expect(sameFlowSpec(spec, { ...back, depth: 4 })).toBe(false);
    expect(sameFlowSpec(null, null)).toBe(true);
    expect(sameFlowSpec(spec, null)).toBe(false);
    expect(routeFlowOfSpec({ id: 'x', depth: 4, direction: 'out' })).toEqual({ id: 'x', depth: 4 });
  });
});

describe('flow store', () => {
  it('flow and focus exclude each other; a jump leaves the flow; a new root clears the selection, a setting change keeps it', () => {
    const store = createCanvasStore();
    const s = () => store.getState();
    s().selectNode('n1');
    s().setFlow({ id: 'a', depth: 4, direction: 'out' });
    expect(s().flow?.id).toBe('a');
    expect(s().selectedNodeId).toBeNull();
    s().selectNode('n2');
    s().setFlow({ id: 'a', depth: 2, direction: 'out' });
    expect(s().selectedNodeId).toBe('n2');
    s().setFlow({ id: 'b', depth: 2, direction: 'out' });
    expect(s().selectedNodeId).toBeNull();
    s().setFocus({ id: 'f', depth: 2, direction: 'both' });
    expect(s().flow).toBeNull();
    s().setFlow({ id: 'a', depth: 4, direction: 'out' });
    expect(s().focus).toBeNull();
    s().setFlowPicker({ path: 'src' });
    s().setFlow({ id: 'a', depth: 4, direction: 'in' });
    expect(s().flowPicker).toBeNull();
    s().navigateTo({ drillPath: [], nodeId: null });
    expect(s().flow).toBeNull();
    s().setFlow({ id: 'a', depth: 4, direction: 'out' });
    s().setFlow(null);
    expect(s().flow).toBeNull();
  });
});
