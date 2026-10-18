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
 * Map v2 (lane M1) adds the `path` kind — the open container itself, so the
 * URL follows navigation and browser back / forward walk the drill history:
 *
 *   #/p/<projectId>/map/path/packages/server/src      folder / package / file by repo path
 *   #/p/<projectId>/map/path/<file>/Cls.method        symbol by qualified name
 *   #/p/<projectId>/map/path/.                        the project root
 *
 * `path` links are emitted only by the Map (never by MCP tools), so
 * `CanvasLinkKind` in `canvas-links.ts` is unchanged.
 */
import type { CanvasLinkKind, CanvasOverlay } from '../canvas-links.js';

export type CanvasRouteTargetKind = CanvasLinkKind | 'path';

export interface CanvasRouteTarget {
  kind: CanvasRouteTargetKind;
  /** Decoded identifier: entity id / qualified name, a file / module path, or (kind `path`) a hierarchy path. */
  identifier: string;
}

export interface CanvasRoute {
  /** Project id from an optional `p/<id>` prefix (wave 2). */
  projectId?: string;
  /** What to navigate to; absent for a bare `#/` or `#/p/<id>`. */
  target?: CanvasRouteTarget;
  overlay?: CanvasOverlay;
}
