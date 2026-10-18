/**
 * The map of the OPEN container: view model (children, links, portals) →
 * React Flow nodes and edges, before layout. `key` changes whenever the
 * visible set or the graph changes — that is what triggers a new layout.
 */
import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, MapView } from '../../contracts/canvas/index.js';
import { useCanvasStore } from '../store/canvas-store';
import { computeMapView } from '../utils/map-view';
import { buildAnnotationMap, buildViewNodes } from '../utils/node-transformer';
import { buildViewEdges } from '../utils/edge-transformer';
import type { GraphData } from './useGraphData';

export interface MapModel {
  view: MapView;
  nodes: Node[];
  edges: Edge<CanvasEdgeData>[];
  key: string;
}

export function useMapModel(graph: Pick<GraphData, 'hierarchy' | 'relations' | 'relationById' | 'index' | 'annotations' | 'version'>): MapModel {
  const drillPath = useCanvasStore((s) => s.drillPath);
  const showLockfiles = useCanvasStore((s) => s.showLockfiles);
  const { hierarchy, relations, relationById, index, annotations, version } = graph;

  const view = useMemo(() => computeMapView(hierarchy, relations, drillPath, { showLockfiles }), [hierarchy, relations, drillPath, showLockfiles]);
  const annMap = useMemo(() => buildAnnotationMap(annotations), [annotations]);
  const nodes = useMemo(
    () => buildViewNodes({ hierarchy, entityById: index.entityById, annotations: annMap }, view),
    [hierarchy, index, annMap, view],
  );
  const edges = useMemo(() => buildViewEdges(view, relationById), [view, relationById]);
  const key = `${version}#${view.containerId}#${showLockfiles ? 'L' : ''}#${nodes.map((n) => n.id).join('|')}`;
  return { view, nodes, edges, key };
}
