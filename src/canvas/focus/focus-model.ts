/**
 * The neighbourhood of a focus: breadth-first walk along the selected relation types and direction,
 * nearest neighbours first, capped at `cap` file cards (the rest folds into "+N more" cards), plus the
 * exact accounting of every relation that touches it. Pure; the grouping into zones is
 * `focus-zones.ts`, the renderer's view model is `focus-view.ts`.
 *
 * Direction follows the relation: `r.from` depends on `r.to`, so `out` from the focus walks from → to
 * (what the focus uses) and `in` walks to → from (who uses the focus).
 *
 * A file or container focus walks FILE to FILE. A symbol focus walks SYMBOL to SYMBOL (the symbol and
 * everything below it start the walk), so a function's neighbourhood is its callers and callees, not
 * everything its file touches; the cards are still files.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import type { Relation } from '../../contracts/relations.js';
import { FOCUS_NODE_CAP, type FocusInfo, type FocusOptions } from '../../contracts/canvas/index.js';
import { fileOfNode, type FocusIndex } from './focus-index';
import type { ResolvedFocus } from './focus-resolve';

export interface FocusModel {
  info: FocusInfo;
  /** Neighbour files drawn as cards, nearest first. */
  shown: string[];
  /** Neighbour files folded into "+N more" cards. */
  folded: string[];
  /** Relations of the selected types that touch the neighbourhood and are drawn or counted by the view (`considered`). */
  relations: Relation[];
}

interface Walk {
  dist: Map<string, number>;
  preds: Map<string, Set<string>>;
}

function walk(index: FocusIndex, byFile: boolean, starts: string[], o: FocusOptions): Walk {
  const adj = byFile ? index.byFile : index.byNode;
  const types = new Set(o.types);
  const dist = new Map<string, number>(starts.map((s) => [s, 0]));
  const preds = new Map<string, Set<string>>();
  let frontier = [...starts];
  for (let d = 0; d < o.depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const i of adj.get(key) ?? []) {
        const ir = index.rels[i];
        if (!types.has(ir.r.type)) continue;
        const a = byFile ? ir.ff : ir.from;
        const b = byFile ? ir.tf : ir.to;
        if (!a || !b || a === b) continue;
        const nb = a === key ? (o.direction !== 'in' ? b : null) : b === key && o.direction !== 'out' ? a : null;
        if (!nb) continue;
        const known = dist.get(nb);
        if (known === undefined) {
          dist.set(nb, d + 1);
          next.push(nb);
          preds.set(nb, new Set([key]));
        } else if (known === d + 1) preds.get(nb)!.add(key);
      }
    }
    frontier = next;
  }
  return { dist, preds };
}

/** Node-level walk → file distances and file-level predecessors (symbol focus). */
function toFiles(h: Hierarchy, w: Walk, owner: string[]): Walk {
  const dist = new Map<string, number>(owner.map((f) => [f, 0]));
  const fileOf = new Map<string, string | null>();
  const of = (n: string) => (fileOf.has(n) ? fileOf.get(n)! : (fileOf.set(n, fileOfNode(h, n)), fileOf.get(n)!));
  for (const [n, d] of w.dist) {
    const f = of(n);
    if (f && (dist.get(f) ?? Infinity) > d) dist.set(f, d);
  }
  const preds = new Map<string, Set<string>>();
  for (const [n, ps] of w.preds) {
    const fn = of(n);
    for (const p of ps) {
      const fp = of(p);
      if (fn && fp && fn !== fp && dist.get(fp)! < dist.get(fn)!) (preds.get(fn) ?? preds.set(fn, new Set()).get(fn)!).add(fp);
    }
  }
  return { dist, preds };
}

export function computeFocusModel(h: Hierarchy, index: FocusIndex, focus: ResolvedFocus, requestedId: string, o: FocusOptions): FocusModel {
  const symbolMode = focus.kind === 'symbol';
  const raw = symbolMode ? walk(index, false, focus.startNodes, o) : walk(index, true, focus.files, o);
  const files = symbolMode ? toFiles(h, raw, focus.files) : raw;
  const focusSet = new Set(focus.files);
  const degree = (f: string) => index.byFile.get(f)?.length ?? 0;
  const pathOf = (f: string) => h.nodes.get(f)?.path ?? f;

  const neighbours = [...files.dist.entries()]
    .filter(([f, d]) => d > 0 && !focusSet.has(f))
    .sort((x, y) => x[1] - y[1] || degree(y[0]) - degree(x[0]) || (pathOf(x[0]) < pathOf(y[0]) ? -1 : 1))
    .map(([f]) => f);
  const room = Math.max(0, (o.cap ?? FOCUS_NODE_CAP) - (focus.kind === 'container' ? 0 : focus.files.length));
  const shown = neighbours.slice(0, room);
  const folded = neighbours.slice(room);
  const inSet = new Set([...focus.files, ...shown, ...folded]);

  // Relations touching the neighbourhood: an end in one of its files (file focus) or nodes (symbol focus).
  const touching = new Set<number>();
  if (symbolMode) for (const n of raw.dist.keys()) for (const i of index.byNode.get(n) ?? []) touching.add(i);
  else for (const f of inSet) for (const i of index.byFile.get(f) ?? []) touching.add(i);
  const types = new Set(o.types);
  const relations: Relation[] = [];
  let excludedByType = 0;
  let lateral = 0;
  /** Steps from the focus of the card a file is drawn in; the focused container is one card at 0. */
  const step = (f: string | null) => (f === null ? undefined : files.dist.get(f));
  const marked = new Set([...shown, ...(focus.kind === 'container' ? [] : focus.files)]);
  const beyond: Record<string, number> = {};
  for (const i of [...touching].sort((x, y) => x - y)) {
    const ir = index.rels[i];
    if (!types.has(ir.r.type)) {
      excludedByType++;
      continue;
    }
    // A link between two neighbours that is not one step further out is "lateral" (see FocusAccounting).
    const [da, db] = [step(ir.ff), step(ir.tf)];
    const sameCard = ir.ff === ir.tf || (focus.kind === 'container' && focusSet.has(ir.ff ?? '') && focusSet.has(ir.tf ?? ''));
    if (!o.lateral && !sameCard && da !== undefined && db !== undefined && Math.abs(da - db) !== 1) {
      lateral++;
      continue;
    }
    relations.push(ir.r);
    for (const [e, other] of [[ir.ff, ir.tf], [ir.tf, ir.ff]] as const) {
      if (e && marked.has(e) && e !== other && (!other || !inSet.has(other))) beyond[e] = (beyond[e] ?? 0) + 1;
    }
  }

  const symbolIds = symbolMode
    ? [focus.focusId, ...[...raw.dist.entries()].filter(([n]) => n !== focus.focusId && h.nodes.get(n)?.kind === 'symbol').sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1)).map(([n]) => n)]
    : [];
  const distance: Record<string, number> = {};
  const preds: Record<string, string[]> = {};
  for (const f of inSet) {
    distance[f] = files.dist.get(f) ?? 0;
    const ps = files.preds.get(f);
    if (ps && !focusSet.has(f)) preds[f] = [...ps].filter((p) => inSet.has(p)).sort();
  }
  const info: FocusInfo = {
    requestedId,
    focusId: focus.focusId,
    kind: focus.kind,
    label: focus.label,
    focusFiles: focus.files,
    symbolIds,
    options: o,
    distance,
    preds,
    shown: shown.length,
    folded: folded.length,
    beyond,
    accounting: { excludedByType, lateral, touching: relations.length + lateral },
    ...noticeOf(shown.length, folded.length, o),
  };
  return { info, shown, folded, relations };
}

function noticeOf(shown: number, folded: number, o: FocusOptions): { notice?: string } {
  if (folded > 0) return { notice: `Showing the ${shown} nearest of ${shown + folded} neighbours; the other ${folded} are folded into “+N more” cards (open one to list them).` };
  if (shown === 0) return { notice: `Nothing within ${o.depth} step${o.depth === 1 ? '' : 's'} along the selected relations (${o.direction === 'both' ? 'either direction' : o.direction === 'in' ? 'who uses it' : 'what it uses'}).` };
  return {};
}
