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
import type { SnapshotData } from '../contracts/analysis/snapshots.js';
import type {
  InterfaceDiff,
  InterfaceDiffEntry,
} from '../contracts/analysis/diff.js';

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

  // Removed entities — present in snapshot, absent from current
  for (const [qn, old] of snapshotMap) {
    if (!currentMap.has(qn)) {
      const dependents = await countDependents(currentGraph, old.id);
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
  for (const [qn, curr] of currentMap) {
    const old = snapshotMap.get(qn);
    if (!old) continue;

    if (old.visibility !== curr.visibility) {
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
 * Returns true when the visibility change is a restriction (broader → narrower).
 *
 * Visibility order from most open to most restricted:
 *   public > protected > internal > private
 */
function isVisibilityReduction(from: string, to: string): boolean {
  const order = ['public', 'protected', 'internal', 'private'];
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  // Unknown visibility values default to -1; treat as no restriction.
  if (fromIdx === -1 || toIdx === -1) return false;
  return toIdx > fromIdx;
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
