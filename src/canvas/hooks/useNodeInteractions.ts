/**
 * Node / edge click handlers.
 *
 * - click: select; inside a VS Code WebView, also ask the host to open the
 *   file. A portal navigates to the container it stands for.
 * - double-click: open the node (its children fill the view; a function
 *   shows itself with its callers and callees as portals)
 * - edge click: select the edge (the detail panel lists its relations)
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { PortalNodeData, ZoneNodeData } from '../../contracts/canvas/index.js';
import { pathTo } from '../../analysis/hierarchy/index.js';
import type { Entity } from '../api/graph-client';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvas-store';
import { openContainerTarget } from '../utils/navigation';
import { focusSpecFor } from '../focus/focus-actions';

export function postEntityClickToHost(entity: Entity | undefined): void {
  if (!entity?.file || !window.parent || window.parent === window) return;
  window.parent.postMessage(
    {
      type: 'flowlens:entity-click',
      file: entity.file,
      line: entity.location?.line_start,
      column: entity.location?.column_start,
    },
    '*',
  );
}

export function useNodeInteractions(entityById: Map<string, Entity>, hierarchy: Hierarchy) {
  const store = useCanvasStoreApi();
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const setDrillPath = useCanvasStore((s) => s.setDrillPath);
  const navigateTo = useCanvasStore((s) => s.navigateTo);
  const setHoveredNode = useCanvasStore((s) => s.setHoveredNode);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (leaveTimer.current && clearTimeout(leaveTimer.current)), []);

  // Hovering a node strengthens its edges. Moving between neighbours passes through gaps; the short
  // delay on leave keeps the edges from flickering between "focused" and "all equal".
  const onNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      if (node.type !== 'portal') setHoveredNode(node.id);
    },
    [setHoveredNode],
  );
  const onNodeMouseLeave = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setHoveredNode(null), 90);
  }, [setHoveredNode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'portal') {
        navigateTo(openContainerTarget(hierarchy, (node.data as PortalNodeData).targetId));
        return;
      }
      selectNode(node.id);
      postEntityClickToHost(entityById.get(node.id));
    },
    [selectNode, navigateTo, entityById, hierarchy],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const target = node.type === 'zone' ? ((node.data as ZoneNodeData).hierarchyId ?? node.id) : node.id;
      // Focus mode: a double-click moves the focus to that card instead of opening it.
      const current = store.getState().focus;
      if (current) {
        const next = focusSpecFor(hierarchy, target, current);
        if (next && node.type !== 'portal') store.getState().setFocus(next);
        return;
      }
      if (node.type === 'portal' || node.type === 'scope' || !hierarchy.nodes.has(target)) return;
      const path = pathTo(hierarchy, target);
      if (path.join('|') === store.getState().drillPath.join('|')) return; // already open (leaf view)
      selectNode(null);
      setDrillPath(path);
    },
    [selectNode, setDrillPath, hierarchy, store],
  );

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => selectEdge(edge.id), [selectEdge]);
  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  return { onNodeClick, onNodeDoubleClick, onEdgeClick, onPaneClick, onNodeMouseEnter, onNodeMouseLeave };
}
