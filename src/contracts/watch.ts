/**
 * Watch-mode contract. The watcher reports filesystem events; an
 * incremental updater applies them to the graph in three levels:
 *
 *   L1 — re-parse the changed files (reuses `parseChunk` from
 *        parallel-parser.ts so the same parsing code powers both the
 *        full index and watch mode).
 *   L2 — write the new entities + relations for each file, deleting
 *        the old ones first (same pattern as `parseAndStore` in the
 *        indexer).
 *   L3 — recompute metrics for affected entities. "Affected" is the
 *        graph neighborhood of the change (entities that gained or
 *        lost an incoming edge), not the whole graph.
 */

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  type: WatchEventType;
  /** Relative path from the watched root. */
  path: string;
  timestamp: number;
}

export interface WatchConfig {
  /** Milliseconds to wait before flushing a batch of changes. Default 300. */
  debounceMs: number;
  /** Glob ignore patterns; should match FlowLensConfig.exclude. */
  ignore: string[];
  /**
   * Use filesystem polling instead of native events. Off by default:
   * polling costs significant idle CPU. Enable only for network or
   * virtualised filesystems where native events are unreliable.
   */
  usePolling?: boolean;
}

export interface FileWatcher {
  /** Start watching. Non-blocking. */
  start(rootDir: string, config: WatchConfig): void;

  /** Stop the watcher and release resources. Idempotent. */
  stop(): Promise<void>;

  /**
   * Register a callback for debounced, batched change events. Only one
   * handler is supported; re-registering replaces.
   */
  onChanges(callback: (events: WatchEvent[]) => Promise<void>): void;

  /** Resolves once the initial scan is complete and events will be delivered. */
  ready(): Promise<void>;
}
