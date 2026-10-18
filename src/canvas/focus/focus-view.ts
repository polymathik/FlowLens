/**
 * Focus mode view model: `computeFocusView(hierarchy, relations, focusId, options)` returns an ordinary
 * `MapView` (same cut, links, accounting as the normal Map) for the neighbourhood of one node, plus
 * `MapView.focus` with the facts the UI needs. The zone renderer does the rest: grouping by the current
 * Group-by, the cut, the layout and the frame bundling are reused, not re-implemented.
 *
 * Differences from the normal zone view:
 *  - the open container is the project, but only the focus and its neighbours are drawn (`fixed` files);
 *  - cross-frame links are drawn at card level, labelled, at full strength (layer `focus`): there are
 *    at most ~80 cards, so no frame-level bundles are needed;
 *  - there are no portals: relations that leave the neighbourhood are counted in `accounting.hidden`.
 *
 * If the id no longer resolves (a re-index removed it) the normal project view is returned without
 * `focus`, and the UI offers to leave Focus mode.
 */
import { PROJECT_NODE_ID, type Hierarchy } from '../../contracts/hierarchy.js';
import type { Relation, RelationType } from '../../contracts/relations.js';
import type { ZoneSet } from '../../contracts/zones.js';
import { FOCUS_DEFAULT_DEPTH, FOCUS_MAX_DEPTH, type FocusDirection, type FocusOptions, type MapView, type MapViewOptions, type ZoneViewOptions } from '../../contracts/canvas/index.js';
import { DEFAULT_VISIBLE_RELATION_TYPES } from '../utils/relation-defaults';
import { computeZoneView } from '../utils/zone-view';
import { getZones } from '../utils/zones-adapter';
import { zoneChainOfFile } from '../utils/zone-cut';
import { focusIndex } from './focus-index';
import { resolveFocus } from './focus-resolve';
import { computeFocusModel } from './focus-model';
import { deriveFocusZones } from './focus-zones';

/** What a caller may leave out (the store and the URL carry partial specs). */
export interface FocusRequest {
  depth?: number;
  direction?: FocusDirection;
  types?: RelationType[];
  cap?: number;
  lateral?: boolean;
}

export function normalizeFocus(r: FocusRequest = {}): FocusOptions {
  const depth = Math.min(FOCUS_MAX_DEPTH, Math.max(1, Math.round(r.depth ?? FOCUS_DEFAULT_DEPTH)));
  return { depth, direction: r.direction ?? 'both', types: [...(r.types ?? DEFAULT_VISIBLE_RELATION_TYPES)], ...(r.cap !== undefined ? { cap: r.cap } : {}), ...(r.lateral ? { lateral: true } : {}) };
}

/** The grouping of the whole project in effect (falls back to folders when the requested mode finds nothing). */
function projectZones(h: Hierarchy, zo: ZoneViewOptions): ZoneSet {
  const set = getZones({ mode: zo.mode, hierarchy: h, scopeId: PROJECT_NODE_ID, overrides: zo.overrides, layers: zo.layers });
  if (set.zones.length > 0 || zo.mode === 'folders') return set;
  const byFolders = getZones({ mode: 'folders', hierarchy: h, scopeId: PROJECT_NODE_ID, overrides: zo.overrides });
  return byFolders.zones.length > 0 ? byFolders : set;
}

export function computeFocusView(
  h: Hierarchy,
  relations: Relation[],
  focusId: string,
  request: FocusRequest = {},
  options: MapViewOptions = { showLockfiles: false },
): MapView {
  const zo: ZoneViewOptions = options.zones ?? { mode: 'folders', expansion: {} };
  const base = projectZones(h, zo);
  const resolved = resolveFocus(h, base, focusId, options.showLockfiles);
  if (!resolved) return computeZoneView(h, relations, PROJECT_NODE_ID, options, zo);

  const model = computeFocusModel(h, focusIndex(h, relations), resolved, focusId, normalizeFocus(request));
  const zoneSet = deriveFocusZones(h, base, resolved, model.shown, model.folded);
  const files = [...resolved.files, ...model.shown, ...model.folded];
  // Every drawn neighbour must be a card, so the frames that hold them are open.
  const reveal = (resolved.kind === 'container' ? model.shown : [...resolved.files, ...model.shown]).flatMap((f) => zoneChainOfFile(h, zoneSet, f, PROJECT_NODE_ID));
  const view = computeZoneView(h, model.relations, PROJECT_NODE_ID, options, { ...zo, reveal: [...(zo.reveal ?? []), ...reveal], fixed: { files, zoneSet } });
  return { ...view, bundles: [], focus: model.info };
}
