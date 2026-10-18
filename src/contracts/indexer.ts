/**
 * Indexer run contracts — what one run of the incremental indexer returns,
 * how a caller asks for one, and the per-project index lock.
 *
 * A run reads `.flowlens/symbols.json` + `.flowlens/file_index.json`,
 * writes the graph, then writes both files back. Two runs on one project
 * must therefore never overlap (Phase 12 review H1): inside the daemon all
 * runs for a project go through its per-project write queue (the
 * `reindex` route, the daemon watcher), and every direct run (`--no-daemon`,
 * the daemon itself) additionally holds `INDEX_LOCK_FILE`, a cross-process
 * lock that is stale only when its holder pid is gone or it stopped
 * heart-beating.
 */
import type { GraphQuality, IndexManifest } from './quality.js';

export interface IndexResult {
  filesDiscovered: number;
  /** Files parsed this run (changed + dependents re-resolved). */
  filesIndexed: number;
  filesSkipped: number;
  filesDeleted: number;
  /** Unchanged files re-parsed because a file they depend on changed. */
  filesReresolved: number;
  /** Entities written this run (equals the stored count after a full index). */
  entitiesCreated: number;
  /** Edges written this run, excluding unresolved records. */
  relationsCreated: number;
  unresolvedRelations: number;
  languageCounts: Record<string, number>;
  errors: Array<{ file: string; message: string }>;
  duration: number;
  quality: GraphQuality;
  manifest: IndexManifest;
}

/** Ask for one indexer run on a project (daemon route body, or a direct run). */
export interface IndexRunRequest {
  /**
   * Hint: only these root-relative paths may have changed or been deleted
   * (watch batches, agent hooks). Omit to hash every discovered file.
   */
  paths?: string[];
  /** Full rebuild (`flowlens init`): ignore the file index and symbol snapshot. */
  full?: boolean;
}

/** Result of applying a batch of file changes (watcher, agent re-index). */
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

/** `<root>/.flowlens/index.lock` — `{ pid, at }`, held for a whole run. */
export const INDEX_LOCK_FILE = 'index.lock';
/** The holder refreshes the lock's mtime this often. */
export const INDEX_LOCK_HEARTBEAT_MS = 2_000;
/** A lock not refreshed for this long is stale even if its pid looks alive (pid reuse). */
export const INDEX_LOCK_STALE_MS = 30_000;
/** How long a direct run waits for another run to finish (default 10 min). */
export const INDEX_LOCK_TIMEOUT_MS = 10 * 60_000;
