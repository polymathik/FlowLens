import { describe, it, expect } from 'vitest';
import { parseCanvasHash, buildCanvasHash } from '../../../src/canvas/router/hash-route.js';
import { buildCanvasUrl } from '../../../src/contracts/canvas-links.js';
import { resolveRouteTarget, targetForEntity } from '../../../src/canvas/utils/navigation.js';
import { fuzzyScore, searchEntities } from '../../../src/canvas/utils/fuzzy-search.js';
import { zoomLevelFor } from '../../../src/canvas/utils/zoom.js';
import { ZOOM_THRESHOLDS } from '../../../src/contracts/canvas/index.js';
import { transformEntitiesToNodes } from '../../../src/canvas/utils/node-transformer.js';
import { entity, sampleGraph } from '../helpers/factories.js';

describe('parseCanvasHash', () => {
  it('parses links produced by buildCanvasUrl', () => {
    const url = buildCanvasUrl({ kind: 'entity', identifier: 'src/foo/bar.ts/Foo', overlay: 'cycles', baseUrl: 'http://x' });
    expect(parseCanvasHash(new URL(url).hash)).toEqual({ target: { kind: 'entity', identifier: 'src/foo/bar.ts/Foo' }, overlay: 'cycles' });
  });

  it('accepts raw slashes, the wave-2 project prefix and ignores unknown overlays', () => {
    expect(parseCanvasHash('#/p/proj%201/file/src/a.ts?overlay=bogus')).toEqual({ projectId: 'proj 1', target: { kind: 'file', identifier: 'src/a.ts' } });
    expect(parseCanvasHash('#/p/abc')).toEqual({ projectId: 'abc' });
    expect(parseCanvasHash('')).toEqual({});
    expect(parseCanvasHash('#/nope/x')).toEqual({});
    expect(parseCanvasHash('#/entity/%E0%A4%A')).toEqual({ target: { kind: 'entity', identifier: '%E0%A4%A' } });
  });

  it('round-trips through buildCanvasHash', () => {
    const route = { projectId: 'p1', target: { kind: 'module' as const, identifier: 'src/api' }, overlay: 'hotspot' as const };
    expect(parseCanvasHash(buildCanvasHash(route))).toEqual(route);
  });
});

describe('resolveRouteTarget / targetForEntity', () => {
  const { entities } = sampleGraph();
  const nodeIds = new Set(transformEntitiesToNodes(entities).map((n) => n.id));
  const lookup = { entities, nodeIds };

  it('entity by id, qualified name or unique name → drill into its file', () => {
    const expected = { drillPath: ['system:src', 'module:src/core', 'file:src/core/store.ts'], nodeId: 'Store' };
    expect(resolveRouteTarget({ kind: 'entity', identifier: 'Store' }, lookup)).toEqual(expected);
    expect(resolveRouteTarget({ kind: 'entity', identifier: 'src/core/store.ts/Store' }, lookup)).toEqual(expected);
  });

  it('file and module links', () => {
    expect(resolveRouteTarget({ kind: 'file', identifier: 'src/index.ts' }, lookup)).toEqual({ drillPath: ['system:src'], nodeId: 'file:src/index.ts' });
    expect(resolveRouteTarget({ kind: 'module', identifier: 'src/ui' }, lookup)).toEqual({ drillPath: ['system:src'], nodeId: 'module:src/ui' });
    // get_module_interface links a file path with kind=module
    expect(resolveRouteTarget({ kind: 'module', identifier: 'src/ui/view.ts' }, lookup)?.nodeId).toBe('file:src/ui/view.ts');
    expect(resolveRouteTarget({ kind: 'module', identifier: 'src/nothing' }, lookup)).toBeNull();
    expect(resolveRouteTarget({ kind: 'entity', identifier: 'missing' }, lookup)).toBeNull();
  });

  it('file / module pseudo-entities target their container node', () => {
    expect(targetForEntity(entity('f', 'src/ui/view.ts', 'file'))).toEqual({ drillPath: ['system:src', 'module:src/ui'], nodeId: 'file:src/ui/view.ts' });
    expect(targetForEntity(entity('m', 'src', 'module'))).toEqual({ drillPath: [], nodeId: 'system:src' });
  });
});

describe('fuzzy search', () => {
  const pool = [
    entity('UserService', 'src/services/user-service.ts', 'class'),
    entity('useState', 'src/hooks/state.ts'),
    entity('renderUser', 'src/ui/view.ts'),
    entity('param', 'src/ui/view.ts', 'parameter'),
  ];

  it('matches subsequences and rejects non-matches', () => {
    expect(fuzzyScore('usrSvc', 'UserService')).not.toBeNull();
    expect(fuzzyScore('xyz', 'UserService')).toBeNull();
  });

  it('ranks prefix / boundary matches above scattered ones and skips parameters', () => {
    expect(searchEntities(pool, 'usrsvc').map((h) => h.entity.name)).toEqual(['UserService']);
    expect(searchEntities(pool, 'use')[0].entity.name).toBe('useState');
    expect(searchEntities(pool, 'param')).toEqual([]);
    expect(searchEntities(pool, 'rndUsr')[0].entity.name).toBe('renderUser');
  });
});

describe('zoomLevelFor', () => {
  it('uses the contract thresholds', () => {
    expect(zoomLevelFor(ZOOM_THRESHOLDS.system - 0.01)).toBe('system');
    expect(zoomLevelFor(ZOOM_THRESHOLDS.system)).toBe('module');
    expect(zoomLevelFor(ZOOM_THRESHOLDS.file - 0.01)).toBe('file');
    expect(zoomLevelFor(ZOOM_THRESHOLDS.file)).toBe('entity');
  });
});
