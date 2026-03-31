/**
 * React hook that runs ELK.js layout on the current React Flow graph.
 * Automatically performs layout after initial nodes are set and
 * re-runs when the drill path changes. Exposes `runLayout` for manual triggers.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  computeElkLayout,
  type LayoutOptions,
} from '../layout/elk-layout';
import { useCanvasStore } from '../store/canvas-store';

export function useLayout(options?: LayoutOptions) {
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow();
  const initialLayoutDone = useRef(false);
  const drillPath = useCanvasStore((s) => s.drillPath);

  const runLayout = useCallback(async () => {
    const nodes = getNodes();
    const edges = getEdges();
    if (nodes.length === 0) return;

    const layoutedNodes = await computeElkLayout(nodes, edges, options);
    setNodes(layoutedNodes);
    requestAnimationFrame(() => fitView({ padding: 0.1 }));
  }, [getNodes, getEdges, setNodes, fitView, options]);

  // Run layout once after initial nodes are set.
  useEffect(() => {
    if (!initialLayoutDone.current) {
      const nodes = getNodes();
      if (nodes.length > 0) {
        initialLayoutDone.current = true;
        runLayout();
      }
    }
  });

  // Re-run layout when drill state changes (visible nodes change).
  useEffect(() => {
    if (initialLayoutDone.current) {
      // Small delay to let React Flow update nodes from the new drill state.
      const timer = setTimeout(() => runLayout(), 50);
      return () => clearTimeout(timer);
    }
  }, [drillPath, runLayout]);

  return { runLayout };
}
