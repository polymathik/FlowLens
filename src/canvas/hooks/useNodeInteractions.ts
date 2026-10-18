/**
 * Node / edge click handlers.
 *
 * - click: select; inside a VS Code WebView, also ask the host to open the
 *   file. A portal navigates to the container it stands for.
 * - double-click: open the node (its children fill the view; a function
 *   shows itself with its callers and callees as portals)
 * - edge click: select the edge (the detail panel lists its relations)
 */
import { useCallback } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { PortalNodeData } from '../../contracts/canvas/index.js';
import { pathTo } from '../../analysis/hierarchy/index.js';
import type { Entity } from '../api/graph-client';
import { useCanvasStore } from '../store/canvas-store';
import { openContainerTarget } from '../utils/navigation';

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
  const selectNode = useCanvasStore((s) => s.selectNode);
  const selectEdge = useCanvasStore((s) => s.selectEdge);
  const setDrillPath = useCanvasStore((s) => s.setDrillPath);
  const navigateTo = useCanvasStore((s) => s.navigateTo);

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
      if (node.type === 'portal' || node.type === 'scope' || !hierarchy.nodes.has(node.id)) return;
      const path = pathTo(hierarchy, node.id);
      if (path.join('|') === useCanvasStore.getState().drillPath.join('|')) return; // already open (leaf view)
      selectNode(null);
      setDrillPath(path);
    },
    [selectNode, setDrillPath, hierarchy],
  );

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => selectEdge(edge.id), [selectEdge]);
  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  return { onNodeClick, onNodeDoubleClick, onEdgeClick, onPaneClick };
}
