/**
 * React hook that runs a d3-force simulation on the current visible nodes.
 *
 * Creates organic clustering where connected nodes gravitate together,
 * similar to the D3 Mobile Patent Suits example. Used for module-level
 * and system-level views where hierarchical layout is less important
 * than showing connectivity patterns.
 */
import { useEffect, useRef, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

interface ForceLayoutOptions {
  /** Repulsion strength between nodes (default -400) */
  strength?: number;
  /** Ideal link distance (default 150) */
  distance?: number;
  /** Whether the force layout is enabled (default true) */
  enabled?: boolean;
}

export function useForceLayout(options?: ForceLayoutOptions) {
  const { setNodes, getNodes, getEdges, fitView } = useReactFlow();
  const simulationRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

  const enabled = options?.enabled ?? true;
  const strength = options?.strength ?? -400;
  const distance = options?.distance ?? 150;

  const runLayout = useCallback(() => {
    if (!enabled) return;

    const nodes = getNodes();
    const edges = getEdges();
    if (nodes.length === 0) return;

    // Stop any running simulation
    if (simulationRef.current) simulationRef.current.stop();

    const centerX = 500;
    const centerY = 400;

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      x: n.position.x || Math.random() * 800,
      y: n.position.y || Math.random() * 600,
    }));

    const simLinks: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    const simulation = forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
          .id((d) => d.id)
          .distance(distance),
      )
      .force('charge', forceManyBody<SimNode>().strength(strength))
      .force('center', forceCenter<SimNode>(centerX, centerY))
      .force('collision', forceCollide<SimNode>().radius(80))
      .force('x', forceX<SimNode>(centerX).strength(0.05))
      .force('y', forceY<SimNode>(centerY).strength(0.05))
      .alpha(1)
      .alphaDecay(0.02); // Slower decay = smoother settling

    simulationRef.current = simulation;

    simulation.on('tick', () => {
      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          const simNode = simNodes.find((sn) => sn.id === node.id);
          if (!simNode) return node;
          return {
            ...node,
            position: { x: simNode.x, y: simNode.y },
          };
        }),
      );
    });

    simulation.on('end', () => {
      requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
    });
  }, [enabled, strength, distance, getNodes, getEdges, setNodes, fitView]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (simulationRef.current) simulationRef.current.stop();
    };
  }, []);

  return { runLayout };
}
