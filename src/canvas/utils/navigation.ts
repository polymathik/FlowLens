/**
 * Navigation targets — which container to open and what to select for a
 * symbol, file, folder or deep link. Shared by search, portals, deep links
 * and the Health screen. Paths are real hierarchy paths of any depth.
 */
import type { Entity } from '../../contracts/entities.js';
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { CanvasRouteTarget, NavigationTarget, OverlayType } from '../../contracts/canvas/index.js';
import type { CanvasOverlay } from '../../contracts/canvas-links.js';
import { PROJECT_NODE_ID, pathTo, resolvePathIdentifier, resolveRef } from '../../analysis/hierarchy/index.js';

/** Deep-link overlay names → store overlay ids. */
export const LINK_OVERLAY_TO_STORE: Record<CanvasOverlay, OverlayType> = {
  complexity: 'complexity-heatmap',
  churn: 'churn-heatmap',
  hotspot: 'hotspot',
  cycles: 'cycles',
  violations: 'architecture-violations',
  diff: 'interface-diff',
};

/** Open `nodeId` itself: its children (or, for a leaf, the node with its portals) fill the view. */
export function openContainerTarget(h: Hierarchy, nodeId: string): NavigationTarget {
  return { drillPath: pathTo(h, nodeId), nodeId: null };
}

/** Show `nodeId` among its siblings (the view of its parent), selected and centred. */
export function revealTarget(h: Hierarchy, nodeId: string): NavigationTarget {
  const parent = h.nodes.get(nodeId)?.parentId;
  return { drillPath: parent ? pathTo(h, parent) : [], nodeId };
}

/** Where a symbol lives: its container's view with the symbol selected. */
export function targetForEntity(h: Hierarchy, entity: Pick<Entity, 'id' | 'file' | 'kind'>): NavigationTarget | null {
  const node = resolveRef(h, entity.id) ?? (entity.kind === 'module' || entity.kind === 'file' ? resolveRef(h, entity.file) : null);
  return node && node !== PROJECT_NODE_ID ? revealTarget(h, node) : null;
}

/** Lookup tables a route needs to resolve an identifier. */
export interface RouteLookup {
  hierarchy: Hierarchy;
  entities: Entity[];
}

function uniqueByName(entities: Entity[], name: string): Entity | undefined {
  const matches = entities.filter((e) => e.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolve a deep-link target, or null when it matches nothing.
 *
 * - entity: id, then qualified_name, then a unique short name
 * - file:   exact path
 * - module: a directory (any depth) or a file path (MCP's get_module_interface links files this way)
 * - path:   Map v2 — opens the container itself (project '.', folder, package, file, symbol)
 */
export function resolveRouteTarget(target: CanvasRouteTarget, lookup: RouteLookup): NavigationTarget | null {
  const { hierarchy: h, entities } = lookup;
  const { identifier } = target;
  if (target.kind === 'path') {
    const id = resolvePathIdentifier(h, identifier);
    return id ? openContainerTarget(h, id) : null;
  }
  if (target.kind === 'entity') {
    const e = entities.find((x) => x.id === identifier) ?? entities.find((x) => x.qualified_name === identifier) ?? uniqueByName(entities, identifier);
    return e ? targetForEntity(h, e) : null;
  }
  const id = resolveRef(h, identifier);
  if (!id || id === PROJECT_NODE_ID) return null;
  if (target.kind === 'file' && !id.startsWith('file:')) return null;
  return revealTarget(h, id);
}
