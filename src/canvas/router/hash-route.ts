/**
 * Hash router — parses and builds canvas deep links.
 *
 * Accepted forms (contract: src/contracts/canvas/router.ts):
 *   #/entity/<encoded id>?overlay=complexity
 *   #/file/<encoded path>   #/module/<encoded path>
 *   #/p/<projectId>/entity/<id>…   (wave-2 project prefix; parsed, ignored for now)
 *
 * Identifiers are percent-encoded by `buildCanvasUrl`, but raw slashes are
 * tolerated so hand-typed links work too.
 */
import type { CanvasRoute } from '../../contracts/canvas/index.js';
import type { CanvasLinkKind, CanvasOverlay } from '../../contracts/canvas-links.js';

const KINDS: ReadonlySet<string> = new Set<CanvasLinkKind>(['entity', 'module', 'file']);
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

  if (segments.length >= 2 && KINDS.has(segments[0])) {
    const identifier = safeDecode(segments.slice(1).join('/'));
    if (identifier) {
      route.target = { kind: segments[0] as CanvasLinkKind, identifier };
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
  if (route.target) parts.push(route.target.kind, encodeURIComponent(route.target.identifier));
  const suffix = route.overlay ? `?overlay=${route.overlay}` : '';
  return `#/${parts.join('/')}${suffix}`;
}
