/**
 * startWatching — keep a project's graph in sync with file changes for
 * `flowlens watch` and `flowlens serve --watch`.
 *
 * With a `RemoteGraphStore` the daemon owns the watcher (one per project,
 * shared by every client that asks) and we only receive its events. With a
 * direct `LevelGraphStore` (`--no-daemon`) we run chokidar in-process as
 * before Phase 9.
 */
import type { GraphStore } from '../contracts/graph.js';
import { loadProjectExcludes } from '../projects/config.js';
import { ChokidarFileWatcher } from '../watch/file-watcher.js';
import { applyWatchEvents } from '../watch/incremental-updater.js';
import { RemoteGraphStore } from './remote-graph-store.js';

export interface WatchUpdate {
  filesReparsed: number;
  filesDeleted: number;
  errors: Array<{ path: string; message: string }>;
  durationMs: number;
}

export interface WatchSessionOptions {
  debounceMs: number;
  onUpdate: (u: WatchUpdate) => void;
}

export type StopWatching = () => Promise<void>;

export async function startWatching(
  graph: GraphStore,
  rootDir: string,
  o: WatchSessionOptions,
): Promise<StopWatching> {
  if (graph instanceof RemoteGraphStore) {
    await graph.watch(o.debounceMs, (e) => o.onUpdate({
      filesReparsed: e.files_reparsed,
      filesDeleted: e.files_deleted,
      errors: e.errors,
      durationMs: e.duration_ms,
    }));
    return async () => { /* released with graph.close() */ };
  }
  const watcher = new ChokidarFileWatcher();
  watcher.onChanges(async (events) => {
    const r = await applyWatchEvents(events, { rootDir, graph });
    o.onUpdate({ filesReparsed: r.filesReparsed, filesDeleted: r.filesDeleted, errors: r.errors, durationMs: r.durationMs });
  });
  watcher.start(rootDir, { debounceMs: o.debounceMs, ignore: loadProjectExcludes(rootDir) });
  await watcher.ready();
  return () => watcher.stop();
}
