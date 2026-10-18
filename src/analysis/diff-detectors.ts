/**
 * Change detectors used by the interface diff computer (split from
 * diff-computer.ts): visibility, parameters (Phase 8 `fn.param` identity),
 * return types, type aliases, structural modification.
 */
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { InterfaceDiffEntry } from '../contracts/analysis/diff.js';

/**
 * Returns true when the visibility change is a restriction (broader → narrower).
 *
 * Visibility order from most open to most restricted:
 *   public > protected > internal > private
 */
export function isVisibilityReduction(from: string, to: string): boolean {
  const order = ['public', 'protected', 'internal', 'private'];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  // Unknown visibility values default to -1; treat as no restriction.
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
}

/**
 * Detect parameter additions and removals for a function/method entity.
 * Parameters are separate entities whose qualified_name is prefixed with
 * the parent function's qualified_name followed by a dot.
 */
export function detectParameterChanges(
  old: Entity,
  curr: Entity,
  snapshotEntities: Entity[],
  currentEntities: Entity[],
): Omit<InterfaceDiffEntry, 'affected_dependents'>[] {
  const oldParams = snapshotEntities.filter((e) => isDirectParameter(e, old));
  const currParams = currentEntities.filter((e) => isDirectParameter(e, curr));

  const oldParamNames = new Set(oldParams.map((p) => p.name));
  const currParamNames = new Set(currParams.map((p) => p.name));

  const results: Omit<InterfaceDiffEntry, 'affected_dependents'>[] = [];

  for (const p of currParams) {
    if (!oldParamNames.has(p.name)) {
      results.push({
        entity_id: curr.id,
        entity_name: curr.name,
        change_type: 'parameter_added',
        severity: 'breaking',
        details: `Parameter '${p.name}' added to ${curr.name}`,
        before: old,
        after: curr,
      });
    }
  }

  for (const p of oldParams) {
    if (!currParamNames.has(p.name)) {
      results.push({
        entity_id: curr.id,
        entity_name: curr.name,
        change_type: 'parameter_removed',
        severity: 'breaking',
        details: `Parameter '${p.name}' removed from ${curr.name}`,
        before: old,
        after: curr,
      });
    }
  }

  return results;
}

/**
 * Detect return type changes by comparing 'return' relations from a
 * function/method entity in the snapshot vs the current graph.
 */
export function detectReturnChanged(
  old: Entity,
  curr: Entity,
  snapshotRelations: Relation[],
  currentEdges: Relation[],
): Omit<InterfaceDiffEntry, 'affected_dependents'> | null {
  const oldReturnTargets = new Set(
    snapshotRelations
      .filter((r) => r.type === 'return' && r.from === old.id)
      .map((r) => r.to),
  );
  const currReturnTargets = new Set(
    currentEdges
      .filter((r) => r.type === 'return' && r.from === curr.id)
      .map((r) => r.to),
  );

  // Only flag a change if at least one side has return relations
  if (oldReturnTargets.size === 0 && currReturnTargets.size === 0) return null;

  const sameTargets =
    oldReturnTargets.size === currReturnTargets.size &&
    [...oldReturnTargets].every((t) => currReturnTargets.has(t));

  if (sameTargets) return null;

  return {
    entity_id: curr.id,
    entity_name: curr.name,
    change_type: 'return_changed',
    severity: 'breaking',
    details: `Return type of '${curr.name}' changed`,
    before: old,
    after: curr,
  };
}

/**
 * Detect changes to type alias definitions. If a 'type' entity exists in
 * both states but its definition length changed significantly (different
 * line range), consider it a type definition change.
 */
export function detectTypeChanged(
  old: Entity,
  curr: Entity,
): Omit<InterfaceDiffEntry, 'affected_dependents'> | null {
  const oldLen = old.location.line_end - old.location.line_start;
  const currLen = curr.location.line_end - curr.location.line_start;

  if (oldLen === currLen) return null;

  return {
    entity_id: curr.id,
    entity_name: curr.name,
    change_type: 'type_changed',
    severity: 'breaking',
    details: `Type '${curr.name}' definition changed (${oldLen + 1} → ${currLen + 1} lines)`,
    before: old,
    after: curr,
  };
}

/**
 * Detect general structural modifications. If an entity's line count
 * changed by more than 50%, flag it as modified (non-breaking catch-all).
 */
export function detectModified(
  old: Entity,
  curr: Entity,
): Omit<InterfaceDiffEntry, 'affected_dependents'> | null {
  const oldLines = old.metrics?.line_count ?? 0;
  const currLines = curr.metrics?.line_count ?? 0;

  // Skip if we don't have meaningful line counts
  if (oldLines === 0 && currLines === 0) return null;

  const maxLines = Math.max(oldLines, currLines);
  const diff = Math.abs(currLines - oldLines);
  const changeRatio = maxLines > 0 ? diff / maxLines : 0;

  if (changeRatio <= 0.5) return null;

  return {
    entity_id: curr.id,
    entity_name: curr.name,
    change_type: 'modified',
    severity: 'non-breaking',
    details: `Entity '${curr.name}' structurally modified (${oldLines} → ${currLines} lines)`,
    before: old,
    after: curr,
  };
}

/**
 * A parameter entity directly owned by `fn`: qualified name `fn.qn + '.' + name`
 * (Phase 8 identity rule), excluding parameters of nested functions.
 */
export function isDirectParameter(e: Entity, fn: Entity): boolean {
  if (e.kind !== 'parameter' || e.file !== fn.file) return false;
  const prefix = fn.qualified_name + '.';
  return e.qualified_name.startsWith(prefix) && !e.qualified_name.slice(prefix.length).includes('.');
}

/** target id → distinct source ids, from a relation list. */
export function dependentsIndex(relations: Relation[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const r of relations) {
    if (!r.to) continue;
    const set = map.get(r.to);
    if (set) set.add(r.from); else map.set(r.to, new Set([r.from]));
  }
  return map;
}

