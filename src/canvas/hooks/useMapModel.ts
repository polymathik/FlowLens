/**
 * The map of the OPEN container: view model (zones as a cut of the tree, or
 * the children of a file / class) → React Flow nodes and edges, before layout.
 * `key` changes whenever the visible set, its labels or the graph change —
 * that is what triggers a new layout (cached by content, see `layoutCut`).
 * `layout` runs the matching layout for this model.
 */
import { useEffect, useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { CanvasEdgeData, MapView, ZoneViewOptions } from '../../contracts/canvas/index.js';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvas-store';
import { buildFileGraph } from '../../analysis/zones/index.js';
import { computeMapView } from '../utils/map-view';
import { buildAnnotationMap, buildViewNodes, NODE_SIZES } from '../utils/node-transformer';
import { buildViewEdges } from '../utils/edge-transformer';
import { expansionKey } from '../utils/zone-cut';
import { symbolCountOf } from '../utils/zone-nodes';
import { computeLayout } from '../layout/compute-layout';
import { layoutCut, rowsFor } from '../layout/cut-layout';
import type { LayoutPositions } from '../layout/types';
import type { GraphData } from './useGraphData';

export interface MapModel {
  view: MapView;
  nodes: Node[];
  edges: Edge<CanvasEdgeData>[];
  key: string;
  /** Positions (and, for frames and cards of zone views, sizes) of every node. */
  layout: () => Promise<LayoutPositions>;
}

type Graph = Pick<GraphData, 'hierarchy' | 'relations' | 'relationById' | 'index' | 'annotations' | 'version'>;

export function useMapModel(graph: Graph): MapModel {
  const store = useCanvasStoreApi();
  const drillPath = useCanvasStore((s) => s.drillPath);
  const showLockfiles = useCanvasStore((s) => s.showLockfiles);
  const groupBy = useCanvasStore((s) => s.groupBy);
  const expansion = useCanvasStore((s) => s.zoneExpansion);
  const overrides = useCanvasStore((s) => s.zoneOverrides);
  const focusNodeId = useCanvasStore((s) => s.focusRequest?.nodeId ?? null);
  const { hierarchy, relations, relationById, index, annotations, version } = graph;

  // Communities: the file graph is built once per graph; the previous assignment warm-starts the search.
  const communities = groupBy === 'communities';
  const assignmentLoaded = useCanvasStore((s) => s.communityAssignment !== null);
  const fileGraph = useMemo(() => (communities ? buildFileGraph(hierarchy, relations) : undefined), [communities, hierarchy, relations]);
  const zones = useMemo<ZoneViewOptions>(
    () => ({
      mode: groupBy, overrides, expansion, revealRefs: focusNodeId ? [focusNodeId] : [],
      ...(communities ? { fileGraph, previousAssignment: store.getState().communityAssignment ?? undefined } : {}),
    }),
    // `assignmentLoaded` re-runs the search once when the saved assignment arrives; later saves must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupBy, overrides, expansion, focusNodeId, communities, fileGraph, assignmentLoaded],
  );
  const view = useMemo(() => computeMapView(hierarchy, relations, drillPath, { showLockfiles, zones }), [hierarchy, relations, drillPath, showLockfiles, zones]);
  const annMap = useMemo(() => buildAnnotationMap(annotations), [annotations]);
  const nodes = useMemo(() => buildViewNodes({ hierarchy, entityById: index.entityById, annotations: annMap }, view), [hierarchy, index, annMap, view]);
  const edges = useMemo(() => buildViewEdges(view, relationById), [view, relationById]);

  // A reveal (search hit, deep link) opens zones; remember them as the user's choices so they stay open.
  useEffect(() => {
    const revealed = view.cut?.revealed ?? [];
    const missing = revealed.filter((id) => store.getState().zoneExpansion[expansionKey(view.containerId, id)] !== true);
    if (missing.length > 0) store.getState().setZoneExpansion(Object.fromEntries(missing.map((id) => [expansionKey(view.containerId, id), true])));
  }, [view, store]);

  const key = useMemo(() => {
    const cut = view.cut ? view.cut.items.map((i) => `${i.id}${i.expanded ? '+' : '-'}${i.label}`).join('|') : nodes.map((n) => n.id).join('|');
    const portals = view.portals.map((p) => p.id).join(',');
    return `${version}#${view.containerId}#${showLockfiles ? 'L' : ''}#${view.zoning?.mode ?? ''}#${cut}#${portals}#${view.scopeId ?? ''}`;
  }, [view, nodes, showLockfiles, version]);

  const layout = useMemo(
    () => async (): Promise<LayoutPositions> => {
      if (!view.cut) return computeLayout(nodes, edges);
      const extras = nodes
        .filter((n) => n.type === 'portal' || n.type === 'scope')
        .map((n) => ({
          id: n.id,
          w: NODE_SIZES[n.type as 'portal' | 'scope'].width,
          h: NODE_SIZES[n.type as 'portal' | 'scope'].height,
          pin: n.type === 'portal' ? ((n.data as { direction?: string }).direction === 'out' ? ('last' as const) : ('first' as const)) : undefined,
        }));
      const boxes = await layoutCut({ cut: view.cut, links: edges, extras, rowsOf: (id) => rowsFor(symbolCountOf(hierarchy, id)) });
      return new Map([...boxes].map(([id, b]) => [id, { x: b.x, y: b.y, w: b.w, h: b.h }]));
    },
    // The model is rebuilt when `key` changes; nodes / edges are derived from the same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return { view, nodes, edges, key, layout };
}
