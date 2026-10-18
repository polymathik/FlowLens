import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { transformEntitiesToNodes } from '../../../src/canvas/utils/node-transformer.js';
import { transformRelationsToEdges, filterEdgesByRelationType } from '../../../src/canvas/utils/edge-transformer.js';
import { buildGraphIndex } from '../../../src/canvas/utils/graph-index.js';
import { getVisibleNodes } from '../../../src/canvas/utils/visible-nodes.js';
import { RELATION_COLORS } from '../../../src/canvas/utils/relation-colors.js';
import { sampleGraph, entity, relation } from '../helpers/factories.js';

const ids = (nodes: Node[]) => nodes.map((n) => n.id).sort();
const data = (n: Node | undefined) => n?.data as Record<string, unknown>;

describe('transformEntitiesToNodes', () => {
  const { entities } = sampleGraph();
  const nodes = transformEntitiesToNodes(entities);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  it('builds all four levels with parent references', () => {
    expect(byId.get('system:src')?.type).toBe('system');
    expect(data(byId.get('module:src/api'))).toMatchObject({ level: 'module', parentSystem: 'system:src', path: 'src/api' });
    expect(data(byId.get('file:src/index.ts'))).toMatchObject({ level: 'file', parentSystem: 'system:src', parentModule: undefined });
    expect(data(byId.get('Store'))).toMatchObject({ level: 'entity', entityKind: 'class', parentFile: 'file:src/core/store.ts', parentModule: 'module:src/core' });
  });

  it('skips parameters and does not turn module/file pseudo-entities into nodes', () => {
    expect(byId.has('p1')).toBe(false);
    expect(byId.has('mod-ui')).toBe(false);
    expect(byId.has('file:src/ui')).toBe(false);
    expect(byId.has('file-view')).toBe(false);
  });

  it('puts churn and hotspot metrics on nodes, max-aggregated on containers', () => {
    expect(data(byId.get('Store'))).toMatchObject({ churnRate: 0.05, hotspotScore: 0.6 });
    expect(data(byId.get('module:src/core'))).toMatchObject({ churnRate: 0.05, hotspotScore: 0.6, qualityScore: 40 });
    expect(data(byId.get('system:src'))).toMatchObject({ churnRate: 0.05, hotspotScore: 0.6 });
    expect(data(byId.get('module:src/ui'))?.churnRate).toBeUndefined();
  });
});

describe('transformRelationsToEdges', () => {
  const { entities, relations } = sampleGraph();
  const nodes = transformEntitiesToNodes(entities);
  const index = buildGraphIndex(entities);
  const edgesAt = (path: string[]) => {
    const visible = new Set(getVisibleNodes(nodes, path).map((n) => n.id));
    return transformRelationsToEdges(relations, visible, index);
  };
  const pairs = (path: string[]) => edgesAt(path).map((e) => `${e.source}->${e.target}`).sort();

  it('aggregates to system level', () => {
    expect(pairs([])).toEqual(['system:src->system:lib']);
  });

  it('aggregates to module level and to files at the system root (mixed levels)', () => {
    expect(pairs(['system:src'])).toEqual([
      'file:src/index.ts->module:src/api',
      'module:src/api->module:src/core',
      'module:src/api->module:src/ui',
      'module:src/core->system:lib',
    ]);
  });

  it('links files of the open module to sibling modules (and siblings to each other)', () => {
    expect(pairs(['system:src', 'module:src/ui'])).toEqual([
      'file:src/ui/view.ts->file:src/ui/widgets.ts',
      'file:src/ui/widgets.ts->file:src/ui/view.ts',
      'module:src/api->file:src/ui/view.ts',
      'module:src/api->module:src/core',
    ]);
  });

  it('records every aggregated type, most frequent first, with counts', () => {
    const edge = edgesAt(['system:src', 'module:src/ui']).find((e) => e.source === 'file:src/ui/view.ts');
    expect(edge?.data).toMatchObject({ kind: 'aggregated-edge', types: ['call', 'import'], dominantType: 'call', count: 2 });
  });

  it('emits a direct entity edge for a single symbol-to-symbol relation', () => {
    const visible = new Set(['render', 'badge']);
    const [edge] = transformRelationsToEdges([relation('render', 'badge', 'call')], visible, index);
    expect(edge.data).toMatchObject({ kind: 'entity-edge', count: 1, dominantType: 'call' });
    expect(edge.data?.relation?.from).toBe('render');
  });

  it('drops self-loops and unknown targets', () => {
    const local = [entity('a', 'src/x/a.ts'), entity('b', 'src/x/b.ts')];
    const idx = buildGraphIndex(local);
    const edges = transformRelationsToEdges([relation('a', 'b'), relation('a', 'ghost')], new Set(['module:src/x']), idx);
    expect(edges).toEqual([]);
  });
});

describe('filterEdgesByRelationType', () => {
  const { entities, relations } = sampleGraph();
  const nodes = transformEntitiesToNodes(entities);
  const visible = new Set(getVisibleNodes(nodes, ['system:src', 'module:src/ui']).map((n) => n.id));
  const edges = transformRelationsToEdges(relations, visible, buildGraphIndex(entities));

  it('keeps an aggregated edge when a non-dominant type is visible and recolours it', () => {
    const filtered = filterEdgesByRelationType(edges, new Set(['import']));
    const viewToWidgets = filtered.find((e) => e.source === 'file:src/ui/view.ts');
    expect(viewToWidgets?.data?.dominantType).toBe('import');
    expect(viewToWidgets?.style?.stroke).toBe(RELATION_COLORS.import);
    // widgets → view is call-only, so it is hidden.
    expect(filtered.find((e) => e.source === 'file:src/ui/widgets.ts')).toBeUndefined();
  });

  it('hides edges whose types are all filtered out', () => {
    expect(filterEdgesByRelationType(edges, new Set(['extend']))).toEqual([]);
  });
});
