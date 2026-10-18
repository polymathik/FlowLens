/**
 * openGraphStore — how every CLI command gets a graph.
 *
 * Default: talk to the FlowLens daemon (auto-started if needed) through a
 * `RemoteGraphStore`, so `serve`, `watch`, `check`, `index`, `init` and hooks
 * can all use the same project at once. With `--no-daemon` or
 * `FLOWLENS_NO_DAEMON=1` (tests/CI), open LevelDB directly — single-process
 * only, as before Phase 9. Either way the project is registered.
 */
import type { GraphStore } from '../contracts/graph.js';
import type { IndexResult, IndexRunRequest } from '../contracts/indexer.js';
import type { OpenGraphOptions } from '../contracts/open-graph.js';
import type { FlowLensConfig } from '../contracts/config.js';
import { NO_DAEMON_ENV } from '../contracts/service.js';
import { LevelGraphStore } from '../graph/levelgraph-store.js';
import { runIndex } from '../indexer/indexer.js';
import { loadProjectConfig } from '../projects/config.js';
import { canonicalRoot, projectFlowlensDir, projectGraphPath } from '../projects/paths.js';
import { join } from 'node:path';
import { FileProjectRegistry } from '../projects/registry.js';
import { connectDaemon } from './autostart.js';
import { RemoteGraphStore } from './remote-graph-store.js';

export type { OpenGraphOptions } from '../contracts/open-graph.js';

export function daemonDisabled(o: OpenGraphOptions = {}): boolean {
  return o.daemon === false || process.env[NO_DAEMON_ENV] === '1';
}

export async function openGraphStore(rootDir: string, o: OpenGraphOptions = {}): Promise<GraphStore> {
  const root = canonicalRoot(rootDir);
  const graphPath = projectGraphPath(root);
  if (daemonDisabled(o)) {
    await registerQuietly(root);
    const store = new LevelGraphStore();
    await store.open(graphPath);
    return store;
  }
  const store = new RemoteGraphStore(
    () => connectDaemon({ timeoutMs: o.startTimeoutMs }),
    o.client ?? 'cli',
    { rpcTimeoutMs: o.rpcTimeoutMs, reindexTimeoutMs: o.reindexTimeoutMs },
  );
  await store.open(graphPath);
  return store;
}

/** Registry problems (e.g. read-only home) must never break a command. */
async function registerQuietly(root: string): Promise<void> {
  try {
    await new FileProjectRegistry().register(root);
  } catch (err) {
    process.stderr.write(`[flowlens] could not register project: ${(err as Error).message}\n`);
  }
}

export interface IndexProjectOptions extends IndexRunRequest {
  rootDir: string;
  /** Direct runs only (the daemon reads `.flowlens/config.json`). Default: that file. */
  config?: FlowLensConfig;
  /** Direct runs only: called once when another run holds the index lock. */
  onLockWait?: (holderPid?: number) => void;
}

/**
 * Run the indexer for a project on `store`: in the daemon's per-project
 * write queue when `store` is daemon-backed (never a client-side run over
 * RPC — concurrent runs would lose edits), else directly under the
 * project's cross-process index lock (`--no-daemon`).
 */
export async function indexProject(store: GraphStore, o: IndexProjectOptions): Promise<IndexResult> {
  if (store instanceof RemoteGraphStore) return store.reindex({ paths: o.paths, full: o.full });
  const flowlensDir = projectFlowlensDir(o.rootDir);
  return runIndex({
    rootDir: o.rootDir,
    graphStore: store,
    config: o.config ?? loadProjectConfig(o.rootDir),
    fileIndexPath: join(flowlensDir, 'file_index.json'),
    flowlensDir,
    incremental: o.full !== true,
    paths: o.full ? undefined : o.paths,
    onLockWait: o.onLockWait,
  });
}
