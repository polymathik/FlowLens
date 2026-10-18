/**
 * Interface Diff Computer: compares current graph state against a stored
 * snapshot and classifies each change as breaking or non-breaking.
 *
 * Breaking changes are those that can break existing consumers:
 *   - Removed entities
 *   - Visibility reduction (e.g. public → private)
 *
 * Non-breaking changes are additions or expansions:
 *   - Added entities
 *   - Visibility expansion (e.g. private → public)
 */

import type { GraphStore } from '../contracts/graph.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { SnapshotData } from '../contracts/analysis/snapshots.js';
import type {
  InterfaceDiff,
  InterfaceDiffEntry,
} from '../contracts/analysis/diff.js';
import {
  isVisibilityReduction, detectParameterChanges, detectReturnChanged,
  detectTypeChanged, detectModified, dependentsIndex,
} from './diff-detectors.js';

export { isDirectParameter } from './diff-detectors.js';

export interface DiffOptions {
  /** When true, only breaking changes are included in the result. */
  breaking_only?: boolean;
  /**
   * Restrict diff to entities whose file path starts with this prefix.
   * Useful for scoping to a sub-package or directory.
   */
  scope?: string;
}

/**
 * Compute the diff between the current graph state and the given snapshot.
 *
 * Entities are matched by `qualified_name` so renames across files are still
 * detected as add+remove pairs rather than silent modifications.
 */
export async function computeDiff(
  currentGraph: GraphStore,
  snapshotData: SnapshotData,
  options?: DiffOptions,
): Promise<InterfaceDiff> {
  const currentEntities = await currentGraph.getAllNodes();

  const currentMap = new Map<string, Entity>(
    currentEntities.map((e) => [e.qualified_name, e]),
  );
  const snapshotMap = new Map<string, Entity>(
    snapshotData.entities.map((e) => [e.qualified_name, e]),
  );

  const changes: InterfaceDiffEntry[] = [];

  // Removed entities — present in snapshot, absent from current. Their
  // dependents no longer exist in the current graph (the edges went with the
  // entity), so the blast radius is counted on the snapshot's relations.
  // Parameters are reported as parameter_added/removed on their function.
  const snapshotDependents = dependentsIndex(snapshotData.relations);
  for (const [qn, old] of snapshotMap) {
    if (old.kind === 'parameter') continue;
    if (!currentMap.has(qn)) {
      const dependents = snapshotDependents.get(old.id)?.size ?? 0;
      changes.push({
        entity_id: old.id,
        entity_name: old.name,
        change_type: 'removed',
        severity: 'breaking',
        affected_dependents: dependents,
        details: `Entity '${old.name}' (${old.kind}) was removed`,
        before: old,
      });
    }
  }

  // Added entities — present in current, absent from snapshot
  for (const [qn, curr] of currentMap) {
    if (curr.kind === 'parameter') continue;
    if (!snapshotMap.has(qn)) {
      changes.push({
        entity_id: curr.id,
        entity_name: curr.name,
        change_type: 'added',
        severity: 'non-breaking',
        affected_dependents: 0,
        details: `Entity '${curr.name}' (${curr.kind}) was added`,
        after: curr,
      });
    }
  }

  // Modified entities — present in both, check for structural changes
  const currentEdges = await currentGraph.getAllEdges();
  for (const [qn, curr] of currentMap) {
    const old = snapshotMap.get(qn);
    if (!old) continue;

    let hasSpecificChange = false;

    if (old.visibility !== curr.visibility) {
      hasSpecificChange = true;
      const reduction = isVisibilityReduction(old.visibility, curr.visibility);
      const dependents = reduction
        ? await countDependents(currentGraph, curr.id)
        : 0;

      changes.push({
        entity_id: curr.id,
        entity_name: curr.name,
        change_type: 'visibility',
        severity: reduction ? 'breaking' : 'non-breaking',
        affected_dependents: dependents,
        details: `Visibility changed from '${old.visibility}' to '${curr.visibility}'`,
        before: old,
        after: curr,
      });
    }

    // Parameter changes — for function/method entities
    if (old.kind === 'function' || old.kind === 'method') {
      const paramChanges = detectParameterChanges(
        old, curr, snapshotData.entities, currentEntities,
      );
      if (paramChanges.length > 0) {
        hasSpecificChange = true;
        for (const pc of paramChanges) {
          changes.push({
            ...pc,
            affected_dependents: await countDependents(currentGraph, curr.id),
          });
        }
      }

      // Return type changes — compare 'return' relations
      const returnChange = detectReturnChanged(
        old, curr, snapshotData.relations, currentEdges,
      );
      if (returnChange) {
        hasSpecificChange = true;
        changes.push({
          ...returnChange,
          affected_dependents: await countDependents(currentGraph, curr.id),
        });
      }
    }

    // Type definition changes — for 'type' entities
    if (old.kind === 'type') {
      const typeChange = detectTypeChanged(old, curr);
      if (typeChange) {
        hasSpecificChange = true;
        changes.push({
          ...typeChange,
          affected_dependents: await countDependents(currentGraph, curr.id),
        });
      }
    }

    // General 'modified' — catch-all for significant structural changes
    if (!hasSpecificChange) {
      const modifiedChange = detectModified(old, curr);
      if (modifiedChange) {
        changes.push({
          ...modifiedChange,
          affected_dependents: 0,
        });
      }
    }
  }

  // Apply filters
  let filtered = changes;

  if (options?.breaking_only) {
    filtered = filtered.filter((c) => c.severity === 'breaking');
  }

  if (options?.scope) {
    const scope = options.scope;
    filtered = filtered.filter(
      (c) =>
        c.before?.file?.startsWith(scope) ||
        c.after?.file?.startsWith(scope),
    );
  }

  // Build summary
  const breakingCount = filtered.filter((c) => c.severity === 'breaking').length;

  const mostImpacted = filtered.reduce<InterfaceDiffEntry | undefined>(
    (max, c) =>
      c.affected_dependents > (max?.affected_dependents ?? -1) ? c : max,
    undefined,
  );

  return {
    from_sha: snapshotData.sha,
    to_sha: 'current',
    changes: filtered,
    summary: {
      total_changes: filtered.length,
      breaking_changes: breakingCount,
      non_breaking_changes: filtered.length - breakingCount,
      most_impacted_entity: mostImpacted?.entity_name,
    },
  };
}

/**
 * Count the number of distinct source entities that have edges pointing TO
 * `entityId` in the current graph.  Used to quantify the blast radius of a
 * breaking change.
 */
async function countDependents(
  graph: GraphStore,
  entityId: string,
): Promise<number> {
  const edges = await graph.getEdgesTo(entityId);
  return new Set(edges.map((e) => e.from)).size;
}
