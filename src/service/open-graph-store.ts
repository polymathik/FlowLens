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
import { NO_DAEMON_ENV } from '../contracts/service.js';
import { LevelGraphStore } from '../graph/levelgraph-store.js';
import { canonicalRoot, projectGraphPath } from '../projects/paths.js';
import { FileProjectRegistry } from '../projects/registry.js';
import { connectDaemon } from './autostart.js';
import { RemoteGraphStore } from './remote-graph-store.js';

export interface OpenGraphOptions {
  /** `false` (from commander's `--no-daemon`) opens LevelDB directly. */
  daemon?: boolean;
  /** Label shown by `flowlens daemon status`. */
  client?: string;
  /** Wait this long for an auto-started daemon (default 15 s). */
  startTimeoutMs?: number;
}

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
