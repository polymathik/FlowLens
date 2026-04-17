/**
 * ELK.js layout engine integration.
 * Computes hierarchical/layered positions for React Flow nodes using ELK.
 *
 * Conforms to the canvas `LayoutEngine` contract in
 * `src/contracts/canvas/layout.ts` — see `createElkEngine()` below.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';
import type {
  LayoutEngine,
  LayoutOptions as ContractLayoutOptions,
} from '../../contracts/canvas/index.js';
import type { CanvasNode, CanvasEdge } from '../../contracts/canvas/index.js';

const elk = new ELK();

/** ELK-specific options (flat bag matching ELK's config keys). */
export interface LayoutOptions {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  layerSpacing?: number;
}

export async function computeElkLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Promise<Node[]> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': options.algorithm ?? 'layered',
      'elk.direction': options.direction ?? 'DOWN',
      'elk.spacing.nodeNode': String(options.nodeSpacing ?? 30),
      'elk.spacing.edgeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(
        options.layerSpacing ?? 60,
      ),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeRouting': 'SPLINES',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width:
        n.measured?.width ?? n.width ?? (n.style?.width as number) ?? 180,
      height:
        n.measured?.height ?? n.height ?? (n.style?.height as number) ?? 60,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  const result = await elk.layout(graph);

  return nodes.map((node) => {
    const elkNode = result.children?.find((n) => n.id === node.id);
    if (!elkNode || elkNode.x === undefined || elkNode.y === undefined) {
      return node;
    }
    return { ...node, position: { x: elkNode.x, y: elkNode.y } };
  });
}

/**
 * Contract-conforming factory. Maps the generic {@link ContractLayoutOptions}
 * (with nested `spacing: {node, layer}`) onto ELK's flat option keys and
 * delegates to {@link computeElkLayout}. Kept alongside the raw function so
 * both styles are usable: the Canvas hooks call `computeElkLayout` for
 * speed; external integrations target the `LayoutEngine` contract.
 */
export function createElkEngine(): LayoutEngine {
  return {
    async computeLayout(
      nodes: CanvasNode[],
      edges: CanvasEdge[],
      options: ContractLayoutOptions,
    ) {
      const positioned = await computeElkLayout(
        nodes as unknown as Node[],
        edges as unknown as Edge[],
        {
          algorithm: options.algorithm,
          direction: options.direction,
          nodeSpacing: options.spacing.node,
          layerSpacing: options.spacing.layer,
        },
      );
      return {
        nodes: positioned as unknown as CanvasNode[],
        edges,
      };
    },
  };
}
