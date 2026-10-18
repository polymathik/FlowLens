/**
 * What React Flow renders, derived from the laid-out nodes/edges: relation
 * type filter (recounted, empty portals dropped), overlay decoration of the
 * nodes, cycle / rule-break edge marking and the store's selection.
 */
import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';
import type { GraphIndex } from '../utils/graph-index';
import type { OverlayExtraData } from '../overlays/types';
import { useCanvasStore } from '../store/canvas-store';
import { applyRelationFilter } from '../utils/edge-transformer';
import { applyOverlay, markProblemEdges } from '../overlays/apply-overlay';

export interface CanvasView {
  displayNodes: Node[];
  displayEdges: Edge<CanvasEdgeData>[];
  /** Ids of the nodes that are shown (after the relation filter). */
  visibleIds: ReadonlySet<string>;
}

export function useCanvasView(nodes: Node[], layoutEdges: Edge<CanvasEdgeData>[], index: GraphIndex, overlayData: OverlayExtraData): CanvasView {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const visibleTypes = useCanvasStore((s) => s.visibleRelationTypes);
  const selectedNode = useCanvasStore((s) => s.selectedNodeId);
  const selectedEdge = useCanvasStore((s) => s.selectedEdgeId);

  const filtered = useMemo(() => applyRelationFilter(nodes, layoutEdges, visibleTypes), [nodes, layoutEdges, visibleTypes]);
  const visibleIds = useMemo(() => new Set(filtered.nodes.map((n) => n.id)), [filtered.nodes]);

  const displayEdges = useMemo(() => {
    const marked = markProblemEdges(filtered.edges, overlay, overlayData, index, visibleIds);
    return selectedEdge ? marked.map((e) => (e.id === selectedEdge ? { ...e, selected: true } : e)) : marked;
  }, [filtered.edges, overlay, overlayData, index, visibleIds, selectedEdge]);

  const displayNodes = useMemo(() => {
    const decorated = applyOverlay(filtered.nodes, overlay, overlayData, index);
    return decorated.map((n) => {
      const selected = n.id === selectedNode;
      return n.selected === selected ? n : { ...n, selected };
    });
  }, [filtered.nodes, overlay, overlayData, index, selectedNode]);

  return { displayNodes, displayEdges, visibleIds };
}
