/**
 * Incremental graph updater — applies a batch of WatchEvents to the
 * existing graph in three levels:
 *
 *   L1 Re-parse:
 *     For each add/change event, read + parse the file via parseChunk
 *     (reusing the same code path as the full indexer).
 *
 *   L2 Apply:
 *     For each parsed file, delete the file's existing nodes/edges,
 *     then write the fresh nodes/edges. For unlink events, just
 *     delete. This is the same pattern as indexer.ts parseAndStore.
 *
 *   L3 Metric refresh (neighborhood-scoped):
 *     Track which entities had an incoming-edge set change. For each,
 *     recompute coupling metrics. Cognitive complexity + hotspot
 *     score come from the fresh parse (already in L2), so only
 *     coupling/instability need recomputing here.
 */
import type { DiscoveredFile } from '../contracts/discovery.js';
import type { GraphStore } from '../contracts/graph.js';
import type { WatchEvent } from '../contracts/watch.js';
import { parseChunk } from '../indexer/parallel-parser.js';
import { computeCouplingMetrics } from '../metrics/coupling.js';
import { LANGUAGE_EXTENSIONS } from '../utils/paths.js';
import { extname } from 'node:path';

export interface UpdateResult {
  filesReparsed: number;
  filesDeleted: number;
  entitiesUpdated: number;
  relationsUpdated: number;
  errors: Array<{ path: string; message: string }>;
  /** Milliseconds spent in this update. */
  durationMs: number;
}

export interface UpdateOptions {
  rootDir: string;
  graph: GraphStore;
}

export async function applyWatchEvents(
  events: WatchEvent[],
  options: UpdateOptions,
): Promise<UpdateResult> {
  const start = Date.now();
  const errors: Array<{ path: string; message: string }> = [];

  // Split events: deletions handled directly, changes/adds go through
  // the re-parse pipeline. Dedupe by path (same file touched twice in
  // one batch resolves to the latest event type).
  const finalByPath = new Map<string, WatchEvent['type']>();
  for (const ev of events) {
    if (isSupportedPath(ev.path)) finalByPath.set(ev.path, ev.type);
  }

  let filesDeleted = 0;
  const toReparse: DiscoveredFile[] = [];
  for (const [path, type] of finalByPath) {
    if (type === 'unlink') {
      await options.graph.deleteEdgesByFile(path);
      await options.graph.deleteNodesByFile(path);
      filesDeleted++;
    } else {
      toReparse.push({
        path,
        absolutePath: `${options.rootDir}/${path}`,
        extension: extname(path),
        language: LANGUAGE_EXTENSIONS[extname(path)] ?? 'unknown',
      });
    }
  }

  // L1: re-parse
  const { parsed, failures } = await parseChunk({
    files: toReparse,
    rootDir: options.rootDir,
  });
  for (const f of failures) errors.push({ path: f.path, message: f.message });

  // L2: apply changes. Track which entity-ids had edge-set changes
  // for L3 metric refresh.
  const entitiesToRefresh = new Set<string>();
  let entitiesUpdated = 0;
  let relationsUpdated = 0;
  for (const file of parsed) {
    // Before overwriting, collect the targets of outbound edges owned by
    // entities in this file — those entities' coupling will change once
    // we rewrite the file's relations.
    const fileEntities = await options.graph.getNodesByFile(file.path);
    for (const entity of fileEntities) {
      const out = await options.graph.getEdgesFrom(entity.id);
      for (const edge of out) entitiesToRefresh.add(edge.to);
    }

    await options.graph.deleteEdgesByFile(file.path);
    await options.graph.deleteNodesByFile(file.path);
    await options.graph.putNodes(file.entities);
    await options.graph.putEdges(file.relations);

    for (const rel of file.relations) entitiesToRefresh.add(rel.to);
    entitiesUpdated += file.entities.length;
    relationsUpdated += file.relations.length;
  }

  // L3: coupling metrics for affected entities only
  for (const entityId of entitiesToRefresh) {
    const entity = await options.graph.getNode(entityId);
    if (!entity || !entity.metrics) continue;
    const coupling = await computeCouplingMetrics(entityId, options.graph);
    entity.metrics = { ...entity.metrics, ...coupling };
    await options.graph.putNode(entity);
  }

  return {
    filesReparsed: parsed.length,
    filesDeleted,
    entitiesUpdated,
    relationsUpdated,
    errors,
    durationMs: Date.now() - start,
  };
}

function isSupportedPath(path: string): boolean {
  const ext = extname(path);
  return ext in LANGUAGE_EXTENSIONS;
}
