/**
 * Watch-mode contract. The watcher reports debounced, batched filesystem
 * events; the incremental updater (`watch/incremental-updater.ts`) applies
 * a batch through the incremental indexer (`runIndex` with
 * `incremental: true` and the batch's paths as a hint), so watch mode gets
 * the same two-pass, cross-file resolution as `flowlens index`:
 *
 *   - changed/added files are re-parsed; unchanged dependents (importers,
 *     barrels, package scope, owners of edges into removed entities) are
 *     re-parsed too and their cross-file edges re-resolved;
 *   - deleted files leave no dangling edges (importers keep explicit
 *     unresolved records instead);
 *   - file index, symbols snapshot, module nodes, churn, quality and the
 *     manifest stay consistent with a full index.
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
