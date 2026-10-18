/**
 * Layout dispatcher — picks force-directed placement for the system/module
 * views and ELK layered placement for file/symbol views, from plain boxes
 * and links (no React Flow instance needed, so it is unit-testable).
 */
import type { Edge, Node } from '@xyflow/react';
import { computeForceLayout, type LayoutBox, type Positions } from './force-layout';

export type LayoutMode = 'force' | 'layered';

/** Force for the overview levels, layered once files/symbols are on screen. */
export function layoutModeFor(drillPath: string[]): LayoutMode {
  const last = drillPath[drillPath.length - 1];
  return !last || last.startsWith('system:') ? 'force' : 'layered';
}

export function boxesFor(nodes: Node[]): LayoutBox[] {
  return nodes.map((n) => ({
    id: n.id,
    width: n.measured?.width ?? Number(n.style?.width ?? n.width ?? 180),
    height: n.measured?.height ?? Number(n.style?.height ?? n.height ?? 60),
  }));
}

export async function computeLayout(
  nodes: Node[],
  edges: Pick<Edge, 'source' | 'target'>[],
  mode: LayoutMode,
): Promise<Positions> {
  const boxes = boxesFor(nodes);
  const links = edges.map((e) => ({ source: e.source, target: e.target }));
  if (mode === 'force') return computeForceLayout(boxes, links);
  // ELK (~1.4 MB) loads only when a file/symbol view is first laid out.
  const { computeElkPositions } = await import('./elk-layout');
  return computeElkPositions(boxes, links);
}
