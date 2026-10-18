/**
 * Derives what React Flow renders from the full node state + store:
 * visible nodes for the drill path (decorated by the active overlay and the
 * store's selection) and edges aggregated to the visible level, filtered by
 * relation type and marked as cycle / rule-break edges.
 *
 * `layoutKey` changes whenever the visible node *set* (or the graph) changes,
 * which is what triggers a new layout — not merely the node count.
 */
import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData } from '../../contracts/canvas/index.js';
import type { Relation } from '../api/graph-client';
import type { GraphIndex } from '../utils/graph-index';
import type { OverlayExtraData } from '../overlays/types';
import { useCanvasStore } from '../store/canvas-store';
import { getVisibleNodes, nodeSetKey } from '../utils/visible-nodes';
import { filterEdgesByRelationType, transformRelationsToEdges } from '../utils/edge-transformer';
import { applyOverlay, markProblemEdges } from '../overlays/apply-overlay';

export interface CanvasView {
  /** Visible nodes as laid out (undecorated) — input for layout. */
  layoutNodes: Node[];
  /** Visible nodes with overlay + selection — what React Flow renders. */
  displayNodes: Node[];
  /** All aggregated edges between visible nodes (unfiltered) — input for layout. */
  layoutEdges: Edge<CanvasEdgeData>[];
  /** Filtered + problem-marked edges — what React Flow renders. */
  displayEdges: Edge<CanvasEdgeData>[];
  visibleIds: ReadonlySet<string>;
  layoutKey: string;
}

export function useCanvasView(
  nodes: Node[],
  relations: Relation[],
  index: GraphIndex,
  overlayData: OverlayExtraData,
  graphVersion: number,
): CanvasView {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const overlay = useCanvasStore((s) => s.activeOverlay);
  const visibleTypes = useCanvasStore((s) => s.visibleRelationTypes);
  const selectedId = useCanvasStore((s) => s.selectedNodeId);

  const layoutNodes = useMemo(() => getVisibleNodes(nodes, drillPath), [nodes, drillPath]);
  const setKey = useMemo(() => nodeSetKey(layoutNodes), [layoutNodes]);
  const layoutKey = `${graphVersion}#${setKey}`;
  // Recomputed only when membership changes, not on every position update.
  const visibleIds = useMemo(() => new Set(setKey ? setKey.split('|') : []), [setKey]);

  const layoutEdges = useMemo(
    () => transformRelationsToEdges(relations, visibleIds, index),
    [relations, visibleIds, index],
  );

  const displayEdges = useMemo(() => {
    const filtered = filterEdgesByRelationType(layoutEdges, visibleTypes);
    return markProblemEdges(filtered, overlay, overlayData, index, visibleIds);
  }, [layoutEdges, visibleTypes, overlay, overlayData, index, visibleIds]);

  const displayNodes = useMemo(() => {
    const decorated = applyOverlay(layoutNodes, overlay, overlayData, index);
    return decorated.map((n) => {
      const selected = n.id === selectedId;
      return n.selected === selected ? n : { ...n, selected };
    });
  }, [layoutNodes, overlay, overlayData, index, selectedId]);

  return { layoutNodes, displayNodes, layoutEdges, displayEdges, visibleIds, layoutKey };
}
