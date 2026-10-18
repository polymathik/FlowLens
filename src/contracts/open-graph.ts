/**
 * How CLI commands, hooks and the explorer obtain a `GraphStore`
 * (`openGraphStore` in src/service/open-graph-store.ts): through the
 * FlowLens daemon (`RemoteGraphStore`) or, with `--no-daemon`, LevelDB
 * directly. Moved here from the service module (Phase 12 review L6).
 */

/** Per-call timeouts of a daemon-backed store. */
export interface RemoteStoreOptions {
  /** Timeout of one graph RPC (default 30 s, env `FLOWLENS_RPC_TIMEOUT_MS`). */
  rpcTimeoutMs?: number;
  /** Timeout of a daemon-side index run, queue wait included (default 10 min). */
  reindexTimeoutMs?: number;
}

export interface OpenGraphOptions extends RemoteStoreOptions {
  /** `false` (from commander's `--no-daemon`) opens LevelDB directly. */
  daemon?: boolean;
  /** Label shown by `flowlens daemon status`. */
  client?: string;
  /** Wait this long for an auto-started daemon (default 15 s). */
  startTimeoutMs?: number;
}

/** Hooks run under Claude Code's per-hook timeouts, so they give up sooner. */
export const HOOK_STORE_TIMEOUTS: Required<RemoteStoreOptions> = {
  rpcTimeoutMs: 10_000,
  reindexTimeoutMs: 45_000,
};
