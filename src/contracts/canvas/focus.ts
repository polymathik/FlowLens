/**
 * Focus mode contract (Map v2, lane M4): the neighbourhood of ONE file,
 * symbol, folder, package or zone — the focus plus every node within `depth`
 * steps along the chosen relation types and direction — drawn by the same
 * zone renderer as the normal Map (grouped by the current Group-by, same cut,
 * layout and bundling).
 *
 *   focus ──(depth 1)── consumers / dependencies ──(depth 2)── …   capped at FOCUS_NODE_CAP cards
 *
 * Pure model: `src/canvas/focus/**`. The view is an ordinary `MapView`
 * (`MapView.focus` carries the focus facts); the exactness contract of
 * `RelationAccounting` holds for it, with
 *   considered = edges + internal + hidden        (portals do not exist in a focus view)
 *   hidden     = relations that leave the neighbourhood (beyond the depth / the card cap's reach)
 * `FocusAccounting.lateral` counts links between neighbours that are not drawn and `excludedByType`
 * the touching relations of unselected types, so no relation that touches the neighbourhood is lost:
 *   brute-force touching = considered + lateral + excludedByType.
 */
import type { RelationType } from '../relations.js';
import type { RelationAccounting } from './map-view.js';

export type FocusDirection = 'in' | 'out' | 'both';

export const FOCUS_DEPTHS = [1, 2, 3] as const;
export const FOCUS_MAX_DEPTH = 3;
export const FOCUS_DEFAULT_DEPTH = 2;
/** Neighbour file cards drawn before the rest folds into "+N more" cards (per zone). */
export const FOCUS_NODE_CAP = 80;

/** What the user chose; stored per project tab and written to the URL. */
export interface FocusSpec {
  /** Hierarchy node id (file, symbol, folder, package…), an entity id / file path, or a zone id (`zone:<mode>:<key>`). */
  id: string;
  /** 1..FOCUS_MAX_DEPTH steps from the focus. */
  depth: number;
  /** `out`: what the focus depends on; `in`: what depends on it. */
  direction: FocusDirection;
  /** Relation types followed; absent = the default structural types (import, call, extend, implement). */
  types?: RelationType[];
  /** Also draw the links between neighbours that are not one step further from the focus (default off). */
  lateral?: boolean;
}

/** Inputs of the pure model. */
export interface FocusOptions {
  depth: number;
  direction: FocusDirection;
  types: RelationType[];
  /** Neighbour cards before folding (default FOCUS_NODE_CAP). */
  cap?: number;
  /** Draw lateral links too (see `FocusAccounting.lateral`). */
  lateral?: boolean;
}

/** What is focused: one file, one symbol (its file is drawn too), or a container / zone (drawn as one card). */
export type FocusKind = 'file' | 'symbol' | 'container';

export interface FocusAccounting {
  /** Relations of an unselected type that touch the neighbourhood (counted, not drawn). */
  excludedByType: number;
  /** Relations of the selected types that touch the neighbourhood: `MapView.accounting.considered + lateral`. */
  touching: number;
  /**
   * Links between two neighbours that are not one step apart from the focus (siblings at the same distance,
   * back links). Counted here and not drawn unless `FocusOptions.lateral`: among 50 consumers they would bury
   * the picture of how the focus connects. Always 0 when `lateral` is on.
   */
  lateral: number;
}

export interface FocusInfo {
  /** The id as requested (`FocusSpec.id`). */
  requestedId: string;
  /** Hierarchy node id (or zone id) that is focused. */
  focusId: string;
  kind: FocusKind;
  /** Display name for the breadcrumb and the bar. */
  label: string;
  /** Files that make up the focus (one for a file / symbol, all files of a container). */
  focusFiles: string[];
  /** Symbol focus: the focused symbol and the symbols reached from it (hierarchy node ids, focus first). */
  symbolIds: string[];
  options: FocusOptions;
  /** File → steps from the focus (0 = focus). Covers shown and folded files. */
  distance: Record<string, number>;
  /** File → files one step closer to the focus on a shortest path (hover highlights these). */
  preds: Record<string, string[]>;
  /** File cards shown beside the focus. */
  shown: number;
  /** Neighbour files folded into "+N more" cards by the cap. */
  folded: number;
  /** Shown file → relations that lead outside the neighbourhood (a hint "+N beyond"). */
  beyond: Record<string, number>;
  accounting: FocusAccounting;
  /** One-line message (cap reached, nothing to follow). */
  notice?: string;
}

/** Item id of the card that stands for the focused container in the cut. */
export const FOCUS_SELF_ZONE_ID = 'zone:focus:self';
/** Prefix of the "+N more" zone ids (`zone:focus:more:<zoneId | root>`). */
export const FOCUS_MORE_PREFIX = 'zone:focus:more:';

export type { RelationAccounting };
