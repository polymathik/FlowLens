import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { RELATION_COLORS } from '../../../src/canvas/utils/relation-colors.js';
import { describeCounts } from '../../../src/canvas/utils/relation-labels.js';
import { sampleHierarchy } from '../helpers/factories.js';

const { viewAt, applyRelationFilter } = sampleHierarchy();
const data = (n: Node | undefined) => n?.data as Record<string, unknown>;
const byId = (nodes: Node[], id: string) => nodes.find((n) => n.id === id);
const pairs = (edges: { source: string; target: string }[]) => edges.map((e) => `${e.source}->${e.target}`).sort();

describe('view nodes (Map v2: only the open container is materialised)', () => {
  it('project level: top-level folders as cards that list counts and top files', () => {
    const { nodes } = viewAt([]);
    expect(nodes.map((n) => n.id).sort()).toEqual(['folder:lib/util', 'folder:src']);
    expect(data(byId(nodes, 'folder:lib/util'))).toMatchObject({ level: 'folder', label: 'lib/util', fileCount: 1, symbolCount: 1, topFiles: ['strings.ts'] });
    expect(data(byId(nodes, 'folder:src'))).toMatchObject({ folderCount: 3, fileCount: 1, symbolCount: 5 });
    expect(data(byId(nodes, 'folder:src')).topFiles).toHaveLength(3);
    // every node carries explicit dimensions (deterministic layout / fit)
    expect(nodes.every((n) => n.width! > 0 && n.height! > 0)).toBe(true);
  });

  it('keeps files as nodes and nests symbols; parameters are not nodes', () => {
    const files = viewAt(['folder:src', 'folder:src/core']).nodes.filter((n) => n.type !== 'portal');
    expect(files.map((n) => n.id)).toEqual(['file:src/core/store.ts']);
    const fileView = viewAt(['folder:src', 'folder:src/core', 'file:src/core/store.ts']).nodes.filter((n) => n.type !== 'portal');
    expect(fileView.map((n) => n.id)).toEqual(['Store']);
    expect(data(fileView[0])).toMatchObject({ level: 'entity', entityKind: 'class' });
  });

  it('puts churn / hotspot / quality metrics on containers (max / mean over symbols)', () => {
    const { nodes } = viewAt(['folder:src']);
    expect(data(byId(nodes, 'folder:src/core'))).toMatchObject({ churnRate: 0.05, hotspotScore: 0.6, qualityScore: 40 });
    expect(data(byId(nodes, 'folder:src/ui'))?.churnRate).toBeUndefined();
  });
});

describe('view edges', () => {
  it('sibling folders aggregate with exact counts and a readable label', () => {
    const { edges } = viewAt(['folder:src']);
    expect(pairs(edges.filter((e) => !e.data!.portal))).toEqual(['file:src/index.ts->folder:src/api', 'folder:src/api->folder:src/core', 'folder:src/api->folder:src/ui']);
    const apiUi = edges.find((e) => e.id === 'agg:folder:src/api->folder:src/ui')!;
    expect(apiUi.data).toMatchObject({ kind: 'entity-edge', count: 1, typeCounts: { import: 1 }, label: 'imports 1' });
    const viewWidgets = viewAt(['folder:src', 'folder:src/ui']).edges.find((e) => e.id === 'agg:file:src/ui/view.ts->file:src/ui/widgets.ts')!;
    expect(viewWidgets.data).toMatchObject({ kind: 'aggregated-edge', count: 2, label: 'calls 1 · imports 1' });
    expect(viewWidgets.data!.relationIds).toHaveLength(2);
  });

  it('links to things OUTSIDE the open container are portals, not gone', () => {
    const { nodes, edges, view } = viewAt(['folder:src', 'folder:src/ui']);
    expect(pairs(edges.filter((e) => !e.data!.portal))).toEqual(['file:src/ui/view.ts->file:src/ui/widgets.ts', 'file:src/ui/widgets.ts->file:src/ui/view.ts']);
    const portals = nodes.filter((n) => n.type === 'portal');
    expect(portals.map((p) => [p.id, (p.data as { count: number }).count])).toEqual([['portal:in:file:src/api/routes.ts', 1]]);
    expect(view.accounting).toMatchObject({ portalIn: 1, portalOut: 0, edges: 3 });
    const core = viewAt(['folder:src', 'folder:src/core']);
    expect(core.nodes.filter((n) => n.type === 'portal').map((n) => n.id)).toEqual(['portal:in:file:src/api/routes.ts', 'portal:out:file:lib/util/strings.ts']);
    expect(core.view.accounting).toMatchObject({ portalIn: 1, portalOut: 1, edges: 0 });
  });

  it('a single relation keeps its relation on the edge', () => {
    const single = viewAt(['folder:src']).edges.find((e) => e.id === 'agg:file:src/index.ts->folder:src/api')!;
    expect(single.data!.kind).toBe('entity-edge');
    expect(single.data!.relation).toBeDefined();
  });
});

describe('applyRelationFilter', () => {
  const { nodes, edges } = viewAt(['folder:src', 'folder:src/ui']);

  it('recounts to the visible types, recolours, and removes portals left empty', () => {
    const r = applyRelationFilter(nodes, edges, new Set(['import']));
    const viewToWidgets = r.edges.find((e) => e.source === 'file:src/ui/view.ts' && e.target === 'file:src/ui/widgets.ts')!;
    expect(viewToWidgets.data).toMatchObject({ count: 1, dominantType: 'import', label: 'imports 1', kind: 'entity-edge' });
    expect(viewToWidgets.style?.stroke).toBe(RELATION_COLORS.import);
    // widgets -> view is call-only: hidden
    expect(r.edges.find((e) => e.source === 'file:src/ui/widgets.ts' && e.target === 'file:src/ui/view.ts')).toBeUndefined();
    expect(data(r.nodes.find((n) => n.id === 'portal:in:file:src/api/routes.ts'))).toMatchObject({ count: 1, hiddenByFilter: 0 });
    // the calls-only view hides the import portal link entirely
    const calls = applyRelationFilter(nodes, edges, new Set(['call']));
    expect(calls.nodes.some((n) => n.type === 'portal')).toBe(false);
  });

  it('hides everything when no type matches', () => {
    const r = applyRelationFilter(nodes, edges, new Set(['extend']));
    expect(r.edges).toEqual([]);
    expect(r.nodes.some((n) => n.type === 'portal')).toBe(false);
  });

  it('describeCounts honours the visible set', () => {
    expect(describeCounts({ import: 12, call: 3 })).toBe('imports 12 · calls 3');
    expect(describeCounts({ import: 12, call: 3 }, new Set(['call']))).toBe('calls 3');
  });
});
