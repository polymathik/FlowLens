import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { transformEntitiesToNodes } from '../../../src/canvas/utils/node-transformer.js';
import { transformRelationsToEdges } from '../../../src/canvas/utils/edge-transformer.js';
import { buildGraphIndex } from '../../../src/canvas/utils/graph-index.js';
import { getVisibleNodes } from '../../../src/canvas/utils/visible-nodes.js';
import { applyOverlay, markProblemEdges } from '../../../src/canvas/overlays/apply-overlay.js';
import type { NodeOverlayStyle } from '../../../src/contracts/canvas/index.js';
import { sampleGraph } from '../helpers/factories.js';

const { entities, relations } = sampleGraph();
const all = transformEntitiesToNodes(entities);
const index = buildGraphIndex(entities);
const SRC = ['system:src'];
const overlayOf = (nodes: Node[], id: string) => (nodes.find((n) => n.id === id)?.data as { overlay?: NodeOverlayStyle }).overlay;

function view(path: string[]) {
  const nodes = getVisibleNodes(all, path);
  const visibleIds = new Set(nodes.map((n) => n.id));
  return { nodes, visibleIds, edges: transformRelationsToEdges(relations, visibleIds, index) };
}

describe('metric overlays', () => {
  const { nodes } = view(SRC);

  it('no overlay leaves nodes untouched', () => {
    expect(applyOverlay(nodes, null, {}, index)).toBe(nodes);
  });

  it('churn colours nodes with churn and mutes the rest', () => {
    const out = applyOverlay(nodes, 'churn-heatmap', {}, index);
    expect(overlayOf(out, 'module:src/core')).toMatchObject({ tag: 'churn' });
    expect(overlayOf(out, 'module:src/core')?.muted).toBeFalsy();
    expect(overlayOf(out, 'module:src/ui')).toMatchObject({ tag: 'churn', muted: true });
  });

  it('hotspot scales the hottest node up (inside the body, not the RF wrapper)', () => {
    const out = applyOverlay(nodes, 'hotspot', {}, index);
    const core = out.find((n) => n.id === 'module:src/core')!;
    expect(overlayOf(out, 'module:src/core')?.scale).toBeCloseTo(1.6);
    expect(overlayOf(out, 'module:src/api')?.scale).toBeLessThan(1.6);
    expect(core.style?.transform).toBeUndefined();
  });

  it('complexity uses the quality band colour', () => {
    const out = applyOverlay(nodes, 'complexity-heatmap', {}, index);
    expect(overlayOf(out, 'module:src/core')?.stroke).toBe('#ea580c'); // 40 → needs care
  });
});

describe('cycles and violations map to the visible level', () => {
  const cycles = [{ entities: ['src/ui/view.ts', 'src/ui/widgets.ts'] }];
  const violations = [{ entity_from: 'handle', entity_to: 'render' }];

  it('a file-path cycle inside one module marks that module at system level (no edge)', () => {
    const { nodes, edges, visibleIds } = view(SRC);
    expect(overlayOf(applyOverlay(nodes, 'cycles', { cycles }, index), 'module:src/ui')).toMatchObject({ tag: 'cycles', strokeStyle: 'dashed' });
    expect(markProblemEdges(edges, 'cycles', { cycles }, index, visibleIds).filter((e) => e.type === 'cycle')).toHaveLength(0);
  });

  it('inside the module both file edges become cycle edges', () => {
    const { edges, visibleIds } = view(['system:src', 'module:src/ui']);
    const marked = markProblemEdges(edges, 'cycles', { cycles }, index, visibleIds).filter((e) => e.type === 'cycle');
    expect(marked.map((e) => `${e.source}->${e.target}`).sort()).toEqual([
      'file:src/ui/view.ts->file:src/ui/widgets.ts',
      'file:src/ui/widgets.ts->file:src/ui/view.ts',
    ]);
    expect(marked[0].data?.is_cycle).toBe(true);
  });

  it('entity-id violations aggregate to module nodes and their edge', () => {
    const { nodes, edges, visibleIds } = view(SRC);
    const decorated = applyOverlay(nodes, 'architecture-violations', { violations }, index);
    expect(overlayOf(decorated, 'module:src/api')?.badge).toBe('1 rule break');
    expect(overlayOf(decorated, 'module:src/ui')?.tag).toBe('violations');
    const marked = markProblemEdges(edges, 'architecture-violations', { violations }, index, visibleIds);
    expect(marked.filter((e) => e.type === 'violation').map((e) => `${e.source}->${e.target}`)).toEqual(['module:src/api->module:src/ui']);
  });

  it('diff entries resolve to the visible ancestor with the most severe change', () => {
    const { nodes } = view(SRC);
    const out = applyOverlay(nodes, 'interface-diff', { diffChanges: [{ entity_id: 'Store', change_type: 'added' }, { entity_id: 'Store', change_type: 'removed' }] }, index);
    expect(overlayOf(out, 'module:src/core')?.badge).toBe('removed');
  });
});
