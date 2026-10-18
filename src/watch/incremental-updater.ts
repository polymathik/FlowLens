/**
 * Incremental graph updater — applies a batch of WatchEvents to the graph
 * through the same incremental indexer as `flowlens index` (Phase 8
 * two-pass pipeline), so watch mode keeps cross-file truth:
 *
 *   1. Collect the batch's supported paths (latest event per path is
 *      irrelevant: the indexer checks what is on disk now).
 *   2. `runIndex({ incremental: true, paths })` hashes only those paths,
 *      re-parses the changed ones, re-parses unchanged dependents (files
 *      importing an added/changed/deleted file, barrels, package scope,
 *      owners of edges into removed entities), rebuilds the project symbol
 *      table and resolves pending relations (pass 2). Deleted files leave
 *      no dangling edges; their importers get explicit unresolved records.
 *   3. File index, symbols snapshot, module nodes, churn, quality and the
 *      manifest are kept up to date exactly as after `flowlens index`.
 *
 * Debouncing/batching stay in the watcher (`file-watcher.ts`); callers run
 * this inside their write queue.
 */
import { mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { FlowLensConfig } from '../contracts/config.js';
import type { GraphStore } from '../contracts/graph.js';
import type { WatchEvent } from '../contracts/watch.js';
import { runIndex } from '../indexer/indexer.js';
import { loadProjectConfig } from '../projects/config.js';
import { LANGUAGE_EXTENSIONS, normalizeRelativePath } from '../utils/paths.js';

export interface UpdateResult {
  /** Files from the batch that were re-parsed (changed or added). */
  filesReparsed: number;
  /** Unchanged files re-parsed because a file they depend on changed. */
  filesReresolved: number;
  /** Indexed files removed from the graph. */
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
  /** Project config (default: `<root>/.flowlens/config.json`). */
  config?: FlowLensConfig;
  /** File index path (default: `<root>/.flowlens/file_index.json`). */
  fileIndexPath?: string;
}

export async function applyWatchEvents(
  events: WatchEvent[],
  options: UpdateOptions,
): Promise<UpdateResult> {
  const start = Date.now();
  const paths = [...new Set(events.map((e) => normalizeRelativePath(e.path)).filter(isSupportedPath))];
  if (paths.length === 0) {
    return {
      filesReparsed: 0, filesReresolved: 0, filesDeleted: 0, entitiesUpdated: 0, relationsUpdated: 0,
      errors: [], durationMs: Date.now() - start,
    };
  }

  const rootDir = resolve(options.rootDir);
  const flowlensDir = join(rootDir, '.flowlens');
  mkdirSync(flowlensDir, { recursive: true });
  const result = await runIndex({
    rootDir,
    graphStore: options.graph,
    config: options.config ?? loadProjectConfig(rootDir),
    fileIndexPath: options.fileIndexPath ?? join(flowlensDir, 'file_index.json'),
    flowlensDir,
    incremental: true,
    paths,
  });

  return {
    filesReparsed: result.filesIndexed - result.filesReresolved,
    filesReresolved: result.filesReresolved,
    filesDeleted: result.filesDeleted,
    entitiesUpdated: result.entitiesCreated,
    relationsUpdated: result.relationsCreated,
    errors: result.errors.map((e) => ({ path: e.file, message: e.message })),
    durationMs: Date.now() - start,
  };
}

function isSupportedPath(path: string): boolean {
  return extname(path) in LANGUAGE_EXTENSIONS;
}
