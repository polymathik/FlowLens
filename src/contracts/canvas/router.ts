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
 *
 * Map v2 (lane M4) adds Focus mode — the neighbourhood of one node:
 *
 *   #/p/<projectId>/map/focus/<id>?depth=2&dir=both&types=import,call
 *
 * `<id>` is a hierarchy node id, entity id, file path or zone id, percent-encoded.
 * `depth` 1..3 (default 2), `dir` in | out | both (default both), `types` a comma list (default: structural types), `lateral=1` also draws links between neighbours.
 * It is a separate segment, not a target kind: a focus link never changes the drill path.
 *
 * Map v2 (lane M6b) adds Flow mode — what happens when something runs:
 *
 *   #/p/<projectId>/map/flow/<entityId>?depth=4[&span=112-123][&dir=in][&follow=call,create,use][&max=60][&tests=1]
 *
 * `<entityId>` is an entity id / entry label / qualified name / file path (see `flow-view.ts`), `span` the line range
 * of an inline handler inside it, `dir` out (default) | in. Like focus, a separate segment that never changes the drill path.
 */
import type { CanvasLinkKind, CanvasOverlay } from '../canvas-links.js';
import type { RelationType } from '../relations.js';
import type { FocusDirection } from './focus.js';
import type { CanvasRouteFlow } from './flow-view.js';

export type CanvasRouteTargetKind = CanvasLinkKind | 'path';

export interface CanvasRouteTarget {
  kind: CanvasRouteTargetKind;
  /** Decoded identifier: entity id / qualified name, a file / module path, or (kind `path`) a hierarchy path. */
  identifier: string;
}

/** Parsed `focus/<id>?…` link. Absent fields mean "the default". */
export interface CanvasRouteFocus {
  id: string;
  depth?: number;
  dir?: FocusDirection;
  types?: RelationType[];
  lateral?: boolean;
}

export interface CanvasRoute {
  /** Project id from an optional `p/<id>` prefix (wave 2). */
  projectId?: string;
  /** What to navigate to; absent for a bare `#/` or `#/p/<id>`. */
  target?: CanvasRouteTarget;
  overlay?: CanvasOverlay;
  /** Map v2 M4: Focus mode link (`…/map/focus/<id>`). */
  focus?: CanvasRouteFocus;
  /** Map v2 M6b: Flow mode link (`…/map/flow/<id>`). */
  flow?: CanvasRouteFlow;
}
