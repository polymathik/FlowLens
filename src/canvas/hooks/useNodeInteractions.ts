/**
 * Node click / double-click / pane-click handlers.
 *
 * - click: select; inside a VS Code WebView, also ask the host to open the file
 * - double-click a container: drill into it using its own ancestry (so a
 *   sibling module replaces the current one); double-click a symbol: select only
 */
import { useCallback } from 'react';
import type { Node } from '@xyflow/react';
import type { Entity } from '../api/graph-client';
import { useCanvasStore } from '../store/canvas-store';
import { drillPathForNode } from '../utils/visible-nodes';

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

export function useNodeInteractions(entityById: Map<string, Entity>) {
  const selectNode = useCanvasStore((s) => s.selectNode);
  const setDrillPath = useCanvasStore((s) => s.setDrillPath);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      postEntityClickToHost(entityById.get(node.id));
    },
    [selectNode, entityById],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const path = drillPathForNode(node);
      if (path) {
        selectNode(null);
        setDrillPath(path);
      } else {
        selectNode(node.id);
      }
    },
    [selectNode, setDrillPath],
  );

  const onPaneClick = useCallback(() => selectNode(null), [selectNode]);

  return { onNodeClick, onNodeDoubleClick, onPaneClick };
}
