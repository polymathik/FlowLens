import { describe, it, expect } from 'vitest';
import { buildExplorerHash, mapRouteKey, parseExplorerHash, tabHash } from '../../../src/canvas/router/explorer-route.js';
import { resolveProjectlessRoute } from '../../../src/canvas/components/explorer/useExplorerRoute.js';
import { buildCanvasUrl } from '../../../src/contracts/canvas-links.js';
import type { ProjectDetail } from '../../../src/contracts/service.js';

describe('explorer hash routes', () => {
  it('parses Home', () => {
    for (const h of ['', '#', '#/', '#/home']) expect(parseExplorerHash(h)).toEqual({ tab: 'home' });
  });

  it('defaults a project tab to Health and parses the map view', () => {
    expect(parseExplorerHash('#/p/abc')).toMatchObject({ tab: 'project', projectId: 'abc', view: 'health' });
    expect(parseExplorerHash('#/p/abc/health')).toMatchObject({ projectId: 'abc', view: 'health' });
    expect(parseExplorerHash('#/p/abc/map')).toMatchObject({ projectId: 'abc', view: 'map' });
  });

  it('parses map targets with overlays in both the /map/ and C3 forms', () => {
    const id = encodeURIComponent('src/a.ts::Foo');
    for (const h of [`#/p/abc/map/entity/${id}?overlay=cycles`, `#/p/abc/entity/${id}?overlay=cycles`]) {
      expect(parseExplorerHash(h)).toEqual({
        tab: 'project', projectId: 'abc', view: 'map', target: { kind: 'entity', identifier: 'src/a.ts::Foo' }, overlay: 'cycles',
      });
    }
    expect(parseExplorerHash('#/p/abc/map?overlay=hotspot')).toMatchObject({ view: 'map', overlay: 'hotspot' });
  });

  it('keeps legacy project-less links as project routes without an id', () => {
    expect(parseExplorerHash('#/file/src%2Fmap%2Fx.ts')).toEqual({
      tab: 'project', projectId: undefined, view: 'map', target: { kind: 'file', identifier: 'src/map/x.ts' }, overlay: undefined,
    });
    expect(parseExplorerHash('#/garbage')).toEqual({ tab: 'home' });
  });

  it('round-trips build → parse', () => {
    const routes = [
      { tab: 'home' as const },
      { tab: 'project' as const, projectId: 'p1', view: 'health' as const },
      { tab: 'project' as const, projectId: 'p1', view: 'map' as const },
      { tab: 'project' as const, projectId: 'p1', view: 'map' as const, target: { kind: 'module' as const, identifier: 'src/api' }, overlay: 'violations' as const },
    ];
    for (const r of routes) expect(parseExplorerHash(buildExplorerHash(r))).toMatchObject(r);
    expect(tabHash('home')).toBe('#/home');
    expect(tabHash('p1', 'map')).toBe('#/p/p1/map');
  });

  it('reads deep links built by buildCanvasUrl with a project id', () => {
    const url = buildCanvasUrl({ kind: 'file', identifier: 'src/x.ts', overlay: 'complexity', projectId: 'p9', baseUrl: 'http://h' });
    expect(url).toBe('http://h/#/p/p9/map/file/src%2Fx.ts?overlay=complexity');
    expect(parseExplorerHash(url.slice(url.indexOf('#')))).toMatchObject({ projectId: 'p9', view: 'map', target: { kind: 'file', identifier: 'src/x.ts' } });
  });

  it('only map routes with a target or overlay have a map key', () => {
    expect(mapRouteKey({ tab: 'home' })).toBeNull();
    expect(mapRouteKey({ tab: 'project', projectId: 'a', view: 'map' })).toBeNull();
    expect(mapRouteKey({ tab: 'project', projectId: 'a', view: 'map', overlay: 'cycles' })).toBe(':?cycles');
  });
});

describe('legacy #/entity links map to a project', () => {
  const route = parseExplorerHash('#/entity/Foo');
  const proj = (id: string) => ({ id }) as ProjectDetail;
  it('uses the active project tab', () => {
    expect(resolveProjectlessRoute(route, 'p2', [proj('p1'), proj('p2')])).toMatchObject({ projectId: 'p2' });
  });
  it('uses the only registered project from Home', () => {
    expect(resolveProjectlessRoute(route, 'home', [proj('p1')])).toMatchObject({ projectId: 'p1' });
  });
  it('falls back to Home when ambiguous, and waits for the list', () => {
    expect(resolveProjectlessRoute(route, 'home', [proj('p1'), proj('p2')])).toEqual({ tab: 'home' });
    expect(resolveProjectlessRoute(route, 'home', null)).toBeNull();
  });
});
