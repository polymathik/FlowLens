/**
 * What React Flow renders, derived from the laid-out nodes/edges: relation
 * type filter (recounted, empty portals dropped), overlay decoration of the
 * nodes, cycle / rule-break edge marking, the store's selection, and the
 * zone view's level of detail (zoomed far out: no cards, no card edges) and
 * focus (edges of the hovered / selected node stay strong).
 */
import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';
import type { GraphIndex } from '../utils/graph-index';
import type { OverlayExtraData } from '../overlays/types';
import { useCanvasStore } from '../store/canvas-store';
import { applyRelationFilter } from '../utils/edge-transformer';
import { applyOverlay, markProblemEdges } from '../overlays/apply-overlay';
import { isSummaryTier } from '../utils/lod';
import { emphasise } from '../utils/emphasis';

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
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const hovered = useCanvasStore((s) => s.hoveredNodeId);

  const filtered = useMemo(() => applyRelationFilter(nodes, layoutEdges, visibleTypes), [nodes, layoutEdges, visibleTypes]);
  const visibleIds = useMemo(() => new Set(filtered.nodes.map((n) => n.id)), [filtered.nodes]);

  const summary = isSummaryTier(tier);
  const displayNodes = useMemo(() => {
    const decorated = applyOverlay(filtered.nodes, overlay, overlayData, index);
    return decorated.map((n) => {
      const selected = n.id === selectedNode;
      const hide = summary && n.type === 'file' && !!(n.data as { zoneId?: string }).zoneId;
      return n.selected === selected && !hide ? n : { ...n, selected, ...(hide ? { hidden: true } : {}) };
    });
  }, [filtered.nodes, overlay, overlayData, index, selectedNode, summary]);

  const displayEdges = useMemo(() => {
    const marked = markProblemEdges(filtered.edges, overlay, overlayData, index, visibleIds);
    const withSelection = selectedEdge ? marked.map((e) => (e.id === selectedEdge ? { ...e, selected: true } : e)) : marked;
    return emphasise(withSelection, displayNodes, hovered ?? selectedNode, summary);
  }, [filtered.edges, overlay, overlayData, index, visibleIds, selectedEdge, displayNodes, hovered, selectedNode, summary]);

  return { displayNodes, displayEdges, visibleIds };
}
