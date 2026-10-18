/**
 * Breadcrumb model: the FULL clickable path from the project root to the
 * open container. Only when the path is too long (character budget) is the
 * middle replaced by a menu entry; the root and the last crumbs always show.
 */
import type { Hierarchy } from '../../contracts/hierarchy.js';
import { resolveContainer } from './map-view';

export interface Crumb {
  /** Hierarchy node id ('project' for the root). */
  id: string;
  label: string;
  /** Full text for the tooltip (path or qualified name). */
  title: string;
  /** Index into the drill path this crumb opens; -1 = project root. */
  level: number;
}

export function crumbsFor(h: Hierarchy, drillPath: string[]): Crumb[] {
  const container = resolveContainer(h, drillPath);
  const path = container === 'project' ? [] : drillPath.slice(0, drillPath.lastIndexOf(container) + 1);
  const root = h.nodes.get('project')!;
  const crumbs: Crumb[] = [{ id: root.id, label: root.name, title: root.name, level: -1 }];
  path.forEach((id, i) => {
    const n = h.nodes.get(id);
    if (!n) return;
    crumbs.push({ id, label: n.name, title: n.kind === 'symbol' ? `${n.path} › ${n.qualifiedName ?? n.name}` : n.path || n.name, level: i });
  });
  return crumbs;
}

export interface CrumbLayout {
  head: Crumb[];
  /** Crumbs folded into the "…" menu (empty when everything fits). */
  hidden: Crumb[];
  tail: Crumb[];
}

export const CRUMB_BUDGET = 96;
const MIN_TAIL = 2;

/** Keep the root and as many trailing crumbs as fit `budget` characters; fold the middle. */
export function layoutCrumbs(crumbs: Crumb[], budget = CRUMB_BUDGET): CrumbLayout {
  const cost = (c: Crumb) => c.label.length + 3;
  const total = crumbs.reduce((s, c) => s + cost(c), 0);
  if (total <= budget || crumbs.length <= MIN_TAIL + 2) return { head: crumbs, hidden: [], tail: [] };
  const head = [crumbs[0]];
  let used = cost(crumbs[0]) + 4;
  const tail: Crumb[] = [];
  for (let i = crumbs.length - 1; i >= 1; i--) {
    if (tail.length >= MIN_TAIL && used + cost(crumbs[i]) > budget) break;
    tail.unshift(crumbs[i]);
    used += cost(crumbs[i]);
  }
  return { head, hidden: crumbs.slice(1, crumbs.length - tail.length), tail };
}
