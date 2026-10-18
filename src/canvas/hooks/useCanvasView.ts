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
import { NO_BREAKS, bulgeStackEdges, decorateBreaks, markLayerBreaks, type LayerBreaks } from '../utils/layer-breaks';
import type { Relation } from '../../contracts/relations.js';
import { emphasiseFocus, type FocusEmphasis } from '../focus/focus-emphasis';

export interface CanvasView {
  displayNodes: Node[];
  displayEdges: Edge<CanvasEdgeData>[];
  /** Ids of the nodes that are shown (after the relation filter). */
  visibleIds: ReadonlySet<string>;
}

/** Layers view: the rule breaks to draw and what is needed to restrict them to the visible relation types. */
export interface LayerView {
  breaks: LayerBreaks;
  relationById: Map<string, Relation>;
  /** Top-level item ids in stack order (edges between non-neighbours swing out to the right). */
  topIds: string[];
}

export function useCanvasView(nodes: Node[], layoutEdges: Edge<CanvasEdgeData>[], index: GraphIndex, overlayData: OverlayExtraData, layerView?: LayerView, focusView?: FocusEmphasis): CanvasView {
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const storeTypes = useCanvasStore((s) => s.visibleRelationTypes);
  // Focus mode shows the relation types it follows, whatever the Relations panel has switched on.
  const focusTypes = focusView?.info.options.types;
  const visibleTypes = useMemo<ReadonlySet<string>>(() => (focusTypes ? new Set(focusTypes) : storeTypes), [focusTypes, storeTypes]);
  const selectedNode = useCanvasStore((s) => s.selectedNodeId);
  const selectedEdge = useCanvasStore((s) => s.selectedEdgeId);
  const tier = useCanvasStore((s) => s.currentZoomLevel);
  const hovered = useCanvasStore((s) => s.hoveredNodeId);

  const filtered = useMemo(() => applyRelationFilter(nodes, layoutEdges, visibleTypes), [nodes, layoutEdges, visibleTypes]);
  const visibleIds = useMemo(() => new Set(filtered.nodes.map((n) => n.id)), [filtered.nodes]);

  const summary = isSummaryTier(tier);
  const displayNodes = useMemo(() => {
    const decorated = decorateBreaks(applyOverlay(filtered.nodes, overlay, overlayData, index), layerView?.breaks ?? NO_BREAKS);
    return decorated.map((n) => {
      const selected = n.id === selectedNode;
      const hide = summary && n.type === 'file' && !!(n.data as { zoneId?: string }).zoneId;
      return n.selected === selected && !hide ? n : { ...n, selected, ...(hide ? { hidden: true } : {}) };
    });
  }, [filtered.nodes, overlay, overlayData, index, selectedNode, summary, layerView?.breaks]);

  const displayEdges = useMemo(() => {
    // In the Layers view the rule breaks are drawn per relation (below); the overlay's node-pair marking would also paint allowed relations.
    const marked = markProblemEdges(filtered.edges, layerView && overlay === 'architecture-violations' ? null : overlay, overlayData, index, visibleIds);
    const broken = layerView ? markLayerBreaks(marked, layerView.breaks, { relationById: layerView.relationById, visibleTypes }) : marked;
    const routed = layerView ? bulgeStackEdges(broken, filtered.nodes, layerView.topIds) : broken;
    const withSelection = selectedEdge ? routed.map((e) => (e.id === selectedEdge ? { ...e, selected: true } : e)) : routed;
    return focusView ? emphasiseFocus(withSelection, displayNodes, hovered ?? selectedNode, focusView, summary) : emphasise(withSelection, displayNodes, hovered ?? selectedNode, summary);
  }, [filtered.edges, filtered.nodes, overlay, overlayData, index, visibleIds, selectedEdge, displayNodes, hovered, selectedNode, summary, layerView, visibleTypes, focusView]);

  return { displayNodes, displayEdges, visibleIds };
}
