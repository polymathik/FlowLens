/**
 * Hash router — parses and builds canvas deep links.
 *
 * Accepted forms (contract: src/contracts/canvas/router.ts):
 *   #/entity/<encoded id>?overlay=complexity
 *   #/file/<encoded path>   #/module/<encoded path>
 *   #/p/<projectId>/entity/<id>…   (project prefix)
 *   #/p/<projectId>/map/path/<repo path>   (Map v2: the open container; see contracts/canvas/router.ts)
 *   #/p/<projectId>/map/focus/<id>?depth=2&dir=both&types=import,call   (Map v2 M4: Focus mode)
 *   #/p/<projectId>/map/flow/<id>?depth=4&span=112-123&dir=in           (Map v2 M6b: Flow mode)
 *
 * Identifiers are percent-encoded by `buildCanvasUrl`, but raw slashes are
 * tolerated so hand-typed links work too.
 */
import type { CanvasRoute, CanvasRouteFocus, CanvasRouteTargetKind, FocusDirection } from '../../contracts/canvas/index.js';
import type { CanvasOverlay } from '../../contracts/canvas-links.js';
import type { RelationType } from '../../contracts/relations.js';
import { parseFlowQuery, flowQueryParts } from '../flow/flow-route';

const KINDS: ReadonlySet<string> = new Set<CanvasRouteTargetKind>(['entity', 'module', 'file', 'path']);
const OVERLAYS: ReadonlySet<string> = new Set<CanvasOverlay>([
  'complexity',
  'churn',
  'hotspot',
  'cycles',
  'violations',
  'diff',
]);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const DIRECTIONS: ReadonlySet<string> = new Set<FocusDirection>(['in', 'out', 'both']);
const RELATION_TYPES: ReadonlySet<string> = new Set<RelationType>([
  'import', 'call', 'extend', 'implement', 'override', 'mixin', 'use', 'contain', 'create', 'parameter', 'return', 'throw', 'decorate',
]);

function parseFocus(id: string, query: URLSearchParams): CanvasRouteFocus {
  const focus: CanvasRouteFocus = { id };
  const depth = Number(query.get('depth'));
  if (Number.isInteger(depth) && depth >= 1) focus.depth = depth;
  const dir = query.get('dir');
  if (dir && DIRECTIONS.has(dir)) focus.dir = dir as FocusDirection;
  const types = (query.get('types') ?? '').split(',').filter((t) => RELATION_TYPES.has(t));
  if (types.length > 0) focus.types = types as RelationType[];
  if (query.get('lateral') === '1') focus.lateral = true;
  return focus;
}

export function parseCanvasHash(hash: string): CanvasRoute {
  const raw = hash.replace(/^#/, '').replace(/^\/+/, '');
  const qIndex = raw.indexOf('?');
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : '');

  const route: CanvasRoute = {};
  let segments = pathPart.split('/').filter((s) => s.length > 0);

  if (segments[0] === 'p' && segments.length >= 2) {
    route.projectId = safeDecode(segments[1]);
    segments = segments.slice(2);
  }

  if (segments.length >= 2 && segments[0] === 'focus') {
    const id = safeDecode(segments.slice(1).join('/'));
    if (id) route.focus = parseFocus(id, query);
  } else if (segments.length >= 2 && segments[0] === 'flow') {
    const id = safeDecode(segments.slice(1).join('/'));
    if (id) route.flow = parseFlowQuery(id, query);
  } else if (segments.length >= 2 && KINDS.has(segments[0])) {
    const identifier = safeDecode(segments.slice(1).join('/'));
    if (identifier) {
      route.target = { kind: segments[0] as CanvasRouteTargetKind, identifier };
    }
  }

  const overlay = query.get('overlay');
  if (overlay && OVERLAYS.has(overlay)) route.overlay = overlay as CanvasOverlay;
  return route;
}

/** Inverse of `parseCanvasHash` (same encoding as `buildCanvasUrl`). */
export function buildCanvasHash(route: CanvasRoute): string {
  const parts: string[] = [];
  if (route.projectId) parts.push('p', encodeURIComponent(route.projectId));
  if (route.target) {
    // `path` identifiers are repo paths: keep '/' readable, encode each segment.
    const id =
      route.target.kind === 'path'
        ? route.target.identifier.split('/').map(encodeURIComponent).join('/')
        : encodeURIComponent(route.target.identifier);
    parts.push(route.target.kind, id);
  }
  const query: string[] = [];
  if (route.focus) {
    parts.push('focus', encodeURIComponent(route.focus.id));
    if (route.focus.depth !== undefined) query.push(`depth=${route.focus.depth}`);
    if (route.focus.dir) query.push(`dir=${route.focus.dir}`);
    if (route.focus.types?.length) query.push(`types=${route.focus.types.join(',')}`);
    if (route.focus.lateral) query.push('lateral=1');
  }
  if (route.flow) {
    parts.push('flow', encodeURIComponent(route.flow.id));
    query.push(...flowQueryParts(route.flow));
  }
  if (route.overlay) query.push(`overlay=${route.overlay}`);
  return `#/${parts.join('/')}${query.length ? `?${query.join('&')}` : ''}`;
}
