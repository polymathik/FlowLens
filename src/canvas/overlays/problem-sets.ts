/**
 * Map analysis results (cycles, architecture violations, interface diffs)
 * onto whatever nodes are visible at the current drill level.
 *
 * Cycle members may be file paths (file granularity) or entity ids; violation
 * endpoints are entity ids; diff entries are entity ids. Each is resolved to
 * its deepest visible ancestor through the GraphIndex, so a cycle between
 * two files inside `src/api` and `src/ui` shows up as a cycle between the
 * `api` and `ui` module nodes when viewing `src`.
 */
import type { GraphIndex } from '../utils/graph-index';
import type { OverlayExtraData } from './types';

export interface CycleSets {
  /** Visible node → number of cycles it takes part in. */
  members: Map<string, number>;
  /** Each cycle's resolved visible member set (≥ 1 node). */
  groups: Set<string>[];
}

export function resolveCycles(
  cycles: OverlayExtraData['cycles'],
  index: GraphIndex,
  visibleIds: ReadonlySet<string>,
): CycleSets {
  const members = new Map<string, number>();
  const groups: Set<string>[] = [];
  for (const cycle of cycles ?? []) {
    const group = new Set<string>();
    for (const ref of cycle.entities ?? []) {
      const id = index.resolveVisible(ref, visibleIds);
      if (id) group.add(id);
    }
    if (group.size === 0) continue;
    groups.push(group);
    for (const id of group) members.set(id, (members.get(id) ?? 0) + 1);
  }
  return { members, groups };
}

/** True when an edge joins two distinct members of the same cycle. */
export function isCycleEdge(source: string, target: string, sets: CycleSets): boolean {
  if (source === target) return false;
  return sets.groups.some((g) => g.has(source) && g.has(target));
}

export interface ViolationSets {
  /** Visible node → number of rule breaks it is an endpoint of. */
  members: Map<string, number>;
  /** "source->target" keys of visible pairs that break a rule. */
  pairs: Set<string>;
}

export function resolveViolations(
  violations: OverlayExtraData['violations'],
  index: GraphIndex,
  visibleIds: ReadonlySet<string>,
): ViolationSets {
  const members = new Map<string, number>();
  const pairs = new Set<string>();
  for (const v of violations ?? []) {
    const from = v.entity_from ? index.resolveVisible(v.entity_from, visibleIds) : null;
    const to = v.entity_to ? index.resolveVisible(v.entity_to, visibleIds) : null;
    for (const id of [from, to]) {
      if (id) members.set(id, (members.get(id) ?? 0) + 1);
    }
    if (from && to && from !== to) pairs.add(`${from}->${to}`);
  }
  return { members, pairs };
}

/** Priority of diff change types when several land on one visible node. */
const DIFF_PRIORITY: Record<string, number> = {
  removed: 6,
  type_changed: 5,
  return_changed: 5,
  parameter_removed: 5,
  parameter_added: 4,
  modified: 3,
  visibility: 2,
  added: 1,
};

/** Visible node → most severe change type affecting it. */
export function resolveDiff(
  changes: OverlayExtraData['diffChanges'],
  index: GraphIndex,
  visibleIds: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of changes ?? []) {
    const id = index.resolveVisible(c.entity_id, visibleIds);
    if (!id) continue;
    const prev = out.get(id);
    if (!prev || (DIFF_PRIORITY[c.change_type] ?? 0) > (DIFF_PRIORITY[prev] ?? 0)) {
      out.set(id, c.change_type);
    }
  }
  return out;
}
