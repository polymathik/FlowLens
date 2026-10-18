/**
 * Builds the graph the guard analyses.
 *
 * Fast path: a digest that matches the on-disk graph (read BEFORE the graph
 * is opened, since opening LevelDB rewrites its manifest/log) is expanded into
 * an InMemoryGraph; after re-indexing, only the changed files are re-read from
 * LevelDB (bounded per-file queries) and patched in. Analysis then runs on the
 * in-memory view with the same detectors as a full scan.
 *
 * Known drift: re-indexing refreshes neighbours' coupling metrics in LevelDB;
 * the patched view keeps their previous metrics (affects severity labels
 * only) until the next full digest (any `flowlens index` / cache miss).
 */
import type { Entity } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { Relation } from '../contracts/relations.js';
import type { AgentGraphDigest, IssueScope } from './digest.js';
import { entityFromCompact, relationFromCompact } from './digest-codec.js';
import { InMemoryGraph } from './memory-graph.js';

export function graphFromDigest(digest: AgentGraphDigest): InMemoryGraph {
  return new InMemoryGraph(digest.entities.map(entityFromCompact), digest.edges.map(relationFromCompact));
}

/**
 * Layer rules depend only on an edge and its endpoints, so violations for the
 * changed files can be computed on a small subgraph: edges located in those
 * files plus their endpoint entities. Violations elsewhere come from the digest.
 */
export async function changedFilesScope(
  view: InMemoryGraph,
  digest: AgentGraphDigest,
  files: string[],
): Promise<IssueScope> {
  const set = new Set(files);
  if (digest.violation_count > digest.violations.length) return {}; // digest truncated: full validation
  const edges = (await view.getAllEdges()).filter((edge) => set.has(edge.location.file));
  const ids = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = (await view.getAllNodes()).filter((entity) => ids.has(entity.id));
  return {
    violationsGraph: new InMemoryGraph(nodes, edges),
    keepViolations: digest.violations.filter((violation) => !set.has(violation.file)),
  };
}

/** Re-read `files` from the live store and patch them into the in-memory view. */
export async function patchChangedFiles(
  view: InMemoryGraph,
  live: GraphStore,
  files: string[],
): Promise<void> {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const file of files) {
    const fileEntities = await live.getNodesByFile(file);
    entities.push(...fileEntities);
    for (const entity of fileEntities) {
      for (const relation of await live.getEdgesFrom(entity.id)) {
        if (relation.location.file === file) relations.push(relation);
      }
    }
  }
  view.replaceFiles(files, entities, relations);
}
