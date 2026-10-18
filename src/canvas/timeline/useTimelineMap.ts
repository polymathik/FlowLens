/**
 * The two hook-ins of the Map canvas:
 *
 *  - `useTimelineGraph(graph)` — while the timeline is open, the hierarchy handed to the map model also
 *    holds the files deleted before today (ghost cards), so the layout is computed ONCE from every file
 *    ever seen and never again while the playhead moves.
 *  - `useTimelineView(nodes, edges, view, hierarchy)` — decorates the laid-out nodes and edges for the
 *    commit under the playhead (see decorate.ts). Without an open timeline both are pass-throughs.
 */
import { useMemo } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { CanvasEdgeData, MapView } from '../../contracts/canvas/index.js';
import type { GraphData } from '../hooks/useGraphData';
import { decorateEdges, decorateNodes, type Frame } from './decorate';
import { buildFrame } from './frame';
import { ghostPaths, withGhosts } from './ghost-hierarchy';
import { buildItemMap, type ItemMap } from './items';
import { aliveEdges, indexTopology, sampleFor } from './topo';
import { useLives, useReducedMotion, useTimeline } from './TimelineProvider';

export interface GhostInfo {
  /** Deleted files drawn as ghost cards. */
  added: number;
  /** Deleted files over the cap: counted in the chart, not drawn. */
  dropped: number;
}

export function useTimelineGraph(graph: GraphData): { graph: GraphData; ghosts: GhostInfo; active: boolean } {
  const ready = useTimeline((s) => s.open && s.history !== null);
  const lives = useLives();
  const base = graph.hierarchy;
  return useMemo(() => {
    if (!ready || !lives) return { graph, ghosts: { added: 0, dropped: 0 }, active: false };
    const { paths, dropped } = ghostPaths(base, lives);
    const hierarchy: Hierarchy = withGhosts(base, paths);
    return { graph: hierarchy === base ? graph : { ...graph, hierarchy }, ghosts: { added: paths.length, dropped }, active: true };
    // `graph` is a fresh object every render; its hierarchy is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lives, base]);
}

export interface TimelineView {
  nodes: Node[];
  edges: Edge<CanvasEdgeData>[];
  /** What each item of the cut stands for; null when the timeline is closed or the open container has no zones. */
  items: ItemMap | null;
  frame: Frame | null;
  /** The timeline is open and loaded, but the map shows a file's symbols (no zones): nothing to animate. */
  notApplicable: boolean;
}

export function useTimelineView(nodes: Node[], edges: Edge<CanvasEdgeData>[], view: MapView, hierarchy: Hierarchy): TimelineView {
  const open = useTimeline((s) => s.open);
  const history = useTimeline((s) => s.history);
  const index = useTimeline((s) => s.index);
  const prev = useTimeline((s) => s.prev);
  const compareFrom = useTimeline((s) => s.compareFrom);
  const topology = useTimeline((s) => s.topology);
  const lives = useLives();
  const reduced = useReducedMotion();
  const live = open && history !== null && lives !== null;
  const cut = view.cut;

  const items = useMemo(() => (live && cut ? buildItemMap(cut, hierarchy) : null), [live, cut, hierarchy]);
  const topoIndex = useMemo(() => (history && topology ? indexTopology(history, topology) : null), [history, topology]);
  const samplePos = topoIndex ? sampleFor(topoIndex, index) : null;
  const weights = useMemo(
    () => (topology && samplePos !== null && items ? aliveEdges(topology, samplePos, items) : null),
    [topology, samplePos, items],
  );
  const frame = useMemo(
    () => (lives && items ? buildFrame({ lives, items, index, prev, compareFrom, reduced, edges: weights ?? (topoIndex ? new Map() : null), commits: history!.commits.length }) : null),
    [lives, items, index, prev, compareFrom, reduced, weights, topoIndex, history],
  );
  return useMemo(() => {
    if (!frame) return { nodes, edges, items, frame: null, notApplicable: live && !cut };
    const visible = new Set<string>();
    const outNodes = decorateNodes(nodes, frame, visible);
    return { nodes: outNodes, edges: decorateEdges(edges, frame, visible), items, frame, notApplicable: false };
  }, [frame, nodes, edges, items, live, cut]);
}
