/**
 * Layout for one container view. Deterministic:
 *
 *  - Nodes that take part in a link (including portals) → ELK layered,
 *    left to right, incoming portals first and outgoing portals last.
 *  - Everything else → a sorted grid below them (never scattered).
 *
 * Input order is canonicalised (kind rank, then name) so the same view
 * always lays out identically. Works from plain boxes and links.
 */
import type { Edge, Node } from '@xyflow/react';
import { boundsOf, gridLayout } from './grid-layout';
import type { LayoutBox, Positions } from './types';

export type { LayoutBox, Positions };

const RANK: Record<string, number> = { portal: 0, package: 1, folder: 2, file: 3, entity: 4, scope: 5, config: 6 };
const GAP_BELOW = 56;

function labelOf(n: Node): string {
  return String((n.data as { label?: unknown }).label ?? n.id).toLowerCase();
}

/** Canonical order: in-portals, containers, files, symbols, scope, config, out-portals; then by name. */
export function sortForLayout(nodes: Node[]): Node[] {
  const rank = (n: Node) => {
    const base = RANK[n.type ?? ''] ?? 9;
    if (n.type !== 'portal') return base;
    return (n.data as { direction?: string }).direction === 'out' ? 10 : 0;
  };
  return [...nodes].sort((a, b) => rank(a) - rank(b) || (labelOf(a) < labelOf(b) ? -1 : labelOf(a) > labelOf(b) ? 1 : a.id < b.id ? -1 : 1));
}

export function boxesFor(nodes: Node[]): LayoutBox[] {
  return nodes.map((n) => ({
    id: n.id,
    width: n.measured?.width ?? Number(n.width ?? n.style?.width ?? 180),
    height: n.measured?.height ?? Number(n.height ?? n.style?.height ?? 60),
    pin:
      n.type === 'portal' ? ((n.data as { direction?: string }).direction === 'out' ? ('last' as const) : ('first' as const)) : undefined,
  }));
}

export async function computeLayout(nodes: Node[], edges: Pick<Edge, 'source' | 'target'>[]): Promise<Positions> {
  const sorted = sortForLayout(nodes);
  const boxes = boxesFor(sorted);
  const ids = new Set(boxes.map((b) => b.id));
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const linked = new Set(links.flatMap((e) => [e.source, e.target]));
  const connected = boxes.filter((b) => linked.has(b.id));
  const loose = boxes.filter((b) => !linked.has(b.id));

  let positions: Positions = new Map();
  let belowY = 0;
  if (connected.length > 1) {
    try {
      // ELK (~1.4 MB) loads only when a view with links is first laid out.
      const { computeElkPositions } = await import('./elk-layout');
      positions = await computeElkPositions(connected, links, { direction: 'RIGHT', nodeSpacing: 32, layerSpacing: 96 });
      belowY = boundsOf(connected, positions).height + GAP_BELOW;
    } catch (err) {
      console.error('[flowlens] ELK layout failed, using a grid', err);
      positions = gridLayout(connected);
      belowY = boundsOf(connected, positions).height + GAP_BELOW;
    }
  }
  const grid = gridLayout(connected.length > 1 ? loose : boxes, { originY: belowY });
  for (const [id, p] of grid) positions.set(id, p);
  return positions;
}
