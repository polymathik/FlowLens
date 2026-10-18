/**
 * Canvas hash-route contract.
 *
 * The URL format is produced by `buildCanvasUrl` in `../canvas-links.ts`:
 *
 *   #/entity/<id-or-qualified-name>?overlay=complexity
 *   #/file/<path>   #/module/<path>
 *
 * Wave 2 (multi-project explorer, audit §6.1) prefixes a project segment:
 *
 *   #/p/<projectId>/entity/<id>?overlay=cycles
 *
 * The parser accepts that prefix today and exposes it as `projectId`; the
 * single-project canvas ignores it.
 */
import type { CanvasLinkKind, CanvasOverlay } from '../canvas-links.js';

export interface CanvasRouteTarget {
  kind: CanvasLinkKind;
  /** Decoded identifier: entity id / qualified name, or a file / module path. */
  identifier: string;
}

export interface CanvasRoute {
  /** Project id from an optional `p/<id>` prefix (wave 2). */
  projectId?: string;
  /** What to navigate to; absent for a bare `#/` or `#/p/<id>`. */
  target?: CanvasRouteTarget;
  overlay?: CanvasOverlay;
}
