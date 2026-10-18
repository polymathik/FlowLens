/**
 * "Show on map" for a Health finding: the finding's `focus` becomes a map
 * route (target + overlay) for that project, and its entities/files are
 * queued to be highlighted when the map applies the route.
 */
import type { HealthFinding } from '../../../contracts/health.js';
import type { ExplorerRoute } from '../../../contracts/canvas/index.js';
import { buildExplorerHash, mapRouteKey } from '../../router/explorer-route';
import { setPendingHighlight } from '../../router/map-intents';
import { fileNodeId } from '../../../analysis/hierarchy/ids.js';

export function findingMapRoute(projectId: string, finding: HealthFinding): ExplorerRoute {
  const f = finding.focus;
  return {
    tab: 'project',
    projectId,
    view: 'map',
    target: { kind: f.kind, identifier: f.identifier },
    overlay: f.overlay,
  };
}

/** Node ids to emphasise: the finding's entities plus file nodes of its files. */
export function findingHighlightIds(finding: HealthFinding): string[] {
  return [...new Set([...finding.focus.entity_ids, ...finding.focus.files.map(fileNodeId)])];
}

/** Queue the highlight and return the hash to navigate to. */
export function showOnMapHash(projectId: string, finding: HealthFinding): string {
  const route = findingMapRoute(projectId, finding);
  const key = mapRouteKey(route);
  if (key) setPendingHighlight(projectId, key, findingHighlightIds(finding));
  return buildExplorerHash(route);
}
