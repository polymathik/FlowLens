/**
 * React hook that runs ELK.js layout on the current React Flow graph.
 * Automatically performs layout once after initial nodes are set,
 * and exposes `runLayout` for manual re-layout triggers.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  computeElkLayout,
  type LayoutOptions,
} from '../layout/elk-layout';

export function useLayout(options?: LayoutOptions) {
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow();
  const initialLayoutDone = useRef(false);

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

  return { runLayout };
}
