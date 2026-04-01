/**
 * React hook that runs ELK.js layout on the current React Flow graph.
 *
 * Exposes `runLayout` for the Canvas to trigger manually. Layout timing
 * is managed by Canvas.tsx which chooses between force-directed (d3-force)
 * and hierarchical (ELK) layout depending on the current drill level.
 */
import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  computeElkLayout,
  type LayoutOptions,
} from '../layout/elk-layout';

export function useLayout(options?: LayoutOptions) {
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow();

  const runLayout = useCallback(async () => {
    const nodes = getNodes();
    const edges = getEdges();
    if (nodes.length === 0) return;

    const layoutedNodes = await computeElkLayout(nodes, edges, options);
    setNodes(layoutedNodes);
    requestAnimationFrame(() => fitView({ padding: 0.1 }));
  }, [getNodes, getEdges, setNodes, fitView, options]);

  return { runLayout };
}
