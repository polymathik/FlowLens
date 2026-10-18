/**
 * Navigation targets — where to drill and what to select for a symbol, file
 * or module. Shared by search, deep links and (wave 2) the Health screen.
 */
import type { Entity } from '../../contracts/entities.js';
import type {
  CanvasRouteTarget,
  NavigationTarget,
  OverlayType,
} from '../../contracts/canvas/index.js';
import type { CanvasOverlay } from '../../contracts/canvas-links.js';
import {
  drillPathIntoFile,
  drillPathToShowFile,
  drillPathToShowModule,
  fileId,
  getModulePath,
  moduleId,
  systemId,
  topDir,
} from './hierarchy';

/** Deep-link overlay names → store overlay ids. */
export const LINK_OVERLAY_TO_STORE: Record<CanvasOverlay, OverlayType> = {
  complexity: 'complexity-heatmap',
  churn: 'churn-heatmap',
  hotspot: 'hotspot',
  cycles: 'cycles',
  violations: 'architecture-violations',
  diff: 'interface-diff',
};

function targetForDirectory(dir: string): NavigationTarget {
  const mod = getModulePath(`${dir}/x`);
  if (mod) return { drillPath: drillPathToShowModule(mod), nodeId: moduleId(mod) };
  return { drillPath: [], nodeId: systemId(topDir(dir)) };
}

export function targetForFile(filePath: string): NavigationTarget {
  return { drillPath: drillPathToShowFile(filePath), nodeId: fileId(filePath) };
}

/** Where a symbol lives: drill into its file and select it. */
export function targetForEntity(entity: Entity): NavigationTarget {
  if (entity.kind === 'file') return targetForFile(entity.file);
  if (entity.kind === 'module') return targetForDirectory(entity.file);
  return { drillPath: drillPathIntoFile(entity.file), nodeId: entity.id };
}

/** Lookup tables a route needs to resolve an identifier. */
export interface RouteLookup {
  entities: Entity[];
  nodeIds: ReadonlySet<string>;
}

/**
 * Resolve a deep-link target to a navigation target, or null when the
 * identifier matches nothing in the current graph.
 *
 * - entity: id, then qualified_name, then a unique short name
 * - file:   exact path
 * - module: a module path (src/api), a deeper directory, or a file path
 *           (MCP's get_module_interface links files this way)
 */
export function resolveRouteTarget(
  target: CanvasRouteTarget,
  lookup: RouteLookup,
): NavigationTarget | null {
  const { identifier } = target;
  if (target.kind === 'entity') {
    const entity =
      lookup.entities.find((e) => e.id === identifier) ??
      lookup.entities.find((e) => e.qualified_name === identifier) ??
      uniqueByName(lookup.entities, identifier);
    return entity ? targetForEntity(entity) : null;
  }
  if (target.kind === 'file' || lookup.nodeIds.has(fileId(identifier))) {
    return lookup.nodeIds.has(fileId(identifier)) ? targetForFile(identifier) : null;
  }
  const dir = identifier.replace(/\/+$/, '');
  const t = targetForDirectory(dir);
  return lookup.nodeIds.has(t.nodeId) ? t : null;
}

function uniqueByName(entities: Entity[], name: string): Entity | undefined {
  const matches = entities.filter((e) => e.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}
