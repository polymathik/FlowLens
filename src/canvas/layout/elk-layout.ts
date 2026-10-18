/**
 * ELK.js layout engine integration.
 * Layered placement for the connected part of a container view (the
 * unconnected remainder is a sorted grid, see `grid-layout.ts`). Incoming
 * portals are pinned to the first layer and outgoing ones to the last, so
 * links read left to right: who depends on this → this → what it depends on.
 *
 * Conforms to the canvas `LayoutEngine` contract in
 * `src/contracts/canvas/layout.ts` — see `createElkEngine()` below.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type {
  CanvasEdge,
  CanvasNode,
  LayoutEngine,
  LayoutOptions as ContractLayoutOptions,
} from '../../contracts/canvas/index.js';
import type { LayoutBox, LayoutLink, Positions } from './types';

const elk = new ELK();

/** ELK-specific options (flat bag matching ELK's config keys). */
export interface ElkOptions {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  layerSpacing?: number;
}

export async function computeElkPositions(
  boxes: LayoutBox[],
  links: LayoutLink[],
  options: ElkOptions = {},
): Promise<Positions> {
  const ids = new Set(boxes.map((b) => b.id));
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': options.algorithm ?? 'layered',
      'elk.direction': options.direction ?? 'DOWN',
      'elk.spacing.nodeNode': String(options.nodeSpacing ?? 36),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.componentComponent': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? 72),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.separateConnectedComponents': 'true',
      'elk.aspectRatio': '1.6',
      // Same input -> same picture.
      'elk.randomSeed': '1',
    },
    children: boxes.map((b) => ({
      id: b.id,
      width: b.width,
      height: b.height,
      ...(b.pin
        ? { layoutOptions: { 'elk.layered.layering.layerConstraint': b.pin === 'first' ? 'FIRST_SEPARATE' : 'LAST_SEPARATE' } }
        : {}),
    })),
    edges: links
      .filter((l) => ids.has(l.source) && ids.has(l.target) && l.source !== l.target)
      .map((l, i) => ({ id: `e${i}`, sources: [l.source], targets: [l.target] })),
  };

  const result = await elk.layout(graph);
  const positions: Positions = new Map();
  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }
  return positions;
}

/** Contract-conforming factory (maps nested spacing onto ELK's flat keys). */
export function createElkEngine(): LayoutEngine {
  return {
    async computeLayout(nodes: CanvasNode[], edges: CanvasEdge[], options: ContractLayoutOptions) {
      const positions = await computeElkPositions(
        nodes.map((n) => ({
          id: n.id,
          width: n.measured?.width ?? Number(n.style?.width ?? 180),
          height: n.measured?.height ?? Number(n.style?.height ?? 60),
        })),
        edges,
        {
          algorithm: options.algorithm,
          direction: options.direction,
          nodeSpacing: options.spacing.node,
          layerSpacing: options.spacing.layer,
        },
      );
      return {
        nodes: nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
        edges,
      };
    },
  };
}
