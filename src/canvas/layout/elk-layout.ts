/**
 * ELK.js layout engine integration.
 * Computes hierarchical/layered positions for React Flow nodes using ELK.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

const elk = new ELK();

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
      'elk.spacing.nodeNode': String(options.nodeSpacing ?? 50),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(
        options.layerSpacing ?? 80,
      ),
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
