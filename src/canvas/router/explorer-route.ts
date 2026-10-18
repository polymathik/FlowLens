/**
 * Explorer hash routes (contract: `ExplorerRoute` in contracts/canvas/explorer.ts).
 *
 *   #/ , #/home                       → Home tab
 *   #/p/<id>  , #/p/<id>/health       → project tab, Health screen (default)
 *   #/p/<id>/map                      → project tab, map
 *   #/p/<id>/map/<kind>/<identifier>?overlay=… → map focused on a target
 *   #/p/<id>/<kind>/<identifier>      → same (C3 / buildCanvasUrl form)
 *   #/<kind>/<identifier>             → legacy single-project link; the shell
 *                                       maps it to the active (or only) project
 *
 * `<kind>` is entity | file | module; `map/focus/<id>` and `map/flow/<id>` are the Focus and Flow mode links. Target/overlay parsing is shared with
 * `parseCanvasHash` so every link form decodes identically.
 */
import type { ExplorerRoute, ProjectView } from '../../contracts/canvas/index.js';
import { buildCanvasHash, parseCanvasHash } from './hash-route';
import { flowRouteKey } from '../flow/flow-route';

function splitPath(hash: string): string[] {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '');
  const q = raw.indexOf('?');
  return (q >= 0 ? raw.slice(0, q) : raw).split('/').filter(Boolean);
}

export function parseExplorerHash(hash: string): ExplorerRoute {
  const seg = splitPath(hash);
  if (seg.length === 0 || seg[0] === 'home') return { tab: 'home' };

  // Re-use the canvas parser for target + overlay after dropping our view segment.
  const mapIdx = seg[0] === 'p' ? 2 : 0;
  const view: ProjectView | null = seg[mapIdx] === 'map' ? 'map' : seg[mapIdx] === 'health' ? 'health' : null;
  const stripped = view ? hash.replace(new RegExp(`/(${view})(?=/|\\?|$)`), '') : hash;
  const route = parseCanvasHash(stripped);

  if (seg[0] !== 'p' && !route.target && !route.focus && !route.flow) return { tab: 'home' };
  if (seg[0] === 'p' && !route.projectId) return { tab: 'home' };
  return {
    tab: 'project',
    projectId: route.projectId,
    view: route.target || route.focus || route.flow ? 'map' : (view ?? 'health'),
    target: route.target,
    overlay: route.overlay,
    ...(route.focus ? { focus: route.focus } : {}),
    ...(route.flow ? { flow: route.flow } : {}),
  };
}

export function buildExplorerHash(route: ExplorerRoute): string {
  if (route.tab === 'home') return '#/home';
  if (!route.projectId) return buildCanvasHash({ target: route.target, overlay: route.overlay });
  const id = encodeURIComponent(route.projectId);
  if (route.view === 'health') return `#/p/${id}/health`;
  const rest = buildCanvasHash({ target: route.target, overlay: route.overlay, focus: route.focus, flow: route.flow }).replace(/^#\//, '');
  return `#/p/${id}/map${rest ? `/${rest}`.replace(/\/\?/, '?') : ''}`;
}

/** Stable key of the part of a route the map acts on (target + overlay). */
export function mapRouteKey(route: ExplorerRoute): string | null {
  if (route.tab !== 'project' || route.view !== 'map' || (!route.target && !route.overlay && !route.focus && !route.flow)) return null;
  const f = route.focus;
  const focus = f ? `#focus:${f.id}:${f.depth ?? ''}:${f.dir ?? ''}:${f.types?.join(',') ?? ''}:${f.lateral ? 'L' : ''}` : '';
  const flow = route.flow ? `#flow:${flowRouteKey(route.flow)}` : '';
  return `${route.target?.kind ?? ''}:${route.target?.identifier ?? ''}?${route.overlay ?? ''}${focus}${flow}`;
}

/** Hash that opens a tab ('home' or a project id) on its last sub-view. */
export function tabHash(tab: string, view: ProjectView = 'health'): string {
  return tab === 'home' ? '#/home' : buildExplorerHash({ tab: 'project', projectId: tab, view });
}
