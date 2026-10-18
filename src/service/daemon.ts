/**
 * The FlowLens daemon process: one per user (per `$FLOWLENS_HOME`). Binds
 * 127.0.0.1 on an ephemeral port, writes `daemon.json` (0600) once
 * listening, sweeps leases/idle graphs, and shuts down gracefully (stop
 * watchers → close SSE → close every DB → remove daemon.json).
 */
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import {
  DAEMON_HOST, DEFAULT_SERVICE_OPTIONS, type DaemonInfo, type ServiceOptions,
} from '../contracts/service.js';
import { LevelGraphStore } from '../graph/levelgraph-store.js';
import { FileProjectRegistry } from '../projects/registry.js';
import { createServiceApp, type MountRoutes, type ServiceDeps } from './app.js';
import { removeDaemonInfo, writeDaemonInfo } from './daemon-info.js';
import { EventHub } from './events.js';
import { GraphPool, type StoreFactory } from './graph-pool.js';
import { ProjectCache } from './project-cache.js';
import { createRpcFastPath } from './routes-graph.js';
import { FLOWLENS_VERSION } from './runtime.js';
import { WatcherManager, type Logger, type WatcherFactory } from './watchers.js';
import { DAEMON_PORT_ENV, DEFAULT_EXPLORER_PORT } from '../contracts/canvas/explorer.js';
import { mountExplorer } from './explorer.js';
import { SessionStore } from './sessions.js';

export interface StartDaemonOptions {
  options?: Partial<ServiceOptions>;
  /** Write `$FLOWLENS_HOME/daemon.json` (default true). */
  writeInfo?: boolean;
  storeFactory?: StoreFactory;
  watcherFactory?: WatcherFactory;
  registry?: FileProjectRegistry;
  log?: Logger;
  /** Called after a shutdown completes (the CLI exits the process here). */
  onExit?: () => void;
  /** Extra routes mounted before listening; default: the explorer (`mountExplorer`). `null` = none. */
  mount?: MountRoutes | null;
  /**
   * Port to try first (falls back to an ephemeral port when busy).
   * Default: `$FLOWLENS_DAEMON_PORT`, else 4280; `0` = ephemeral.
   */
  port?: number;
}

/** Preferred listen port: option, env, then the explorer default. */
export function preferredDaemonPort(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const env = Number(process.env[DAEMON_PORT_ENV]);
  if (process.env[DAEMON_PORT_ENV] !== undefined && Number.isInteger(env) && env >= 0 && env <= 65535) return env;
  return DEFAULT_EXPLORER_PORT;
}

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, DAEMON_HOST, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

export interface DaemonHandle {
  info: DaemonInfo;
  app: Express;
  server: Server;
  deps: ServiceDeps;
  shutdown(): Promise<void>;
}

const ENV_OPTIONS: Record<keyof ServiceOptions, string> = {
  idleCloseMs: 'FLOWLENS_DAEMON_IDLE_CLOSE_MS',
  releaseDelayMs: 'FLOWLENS_DAEMON_RELEASE_DELAY_MS',
  maxOpenProjects: 'FLOWLENS_DAEMON_MAX_OPEN',
  leaseTtlMs: 'FLOWLENS_DAEMON_LEASE_TTL_MS',
  rpcEventDebounceMs: 'FLOWLENS_DAEMON_EVENT_DEBOUNCE_MS',
  exitWhenIdleMs: 'FLOWLENS_DAEMON_EXIT_IDLE_MS',
};

export function resolveServiceOptions(overrides: Partial<ServiceOptions> = {}): ServiceOptions {
  const out = { ...DEFAULT_SERVICE_OPTIONS };
  for (const [key, env] of Object.entries(ENV_OPTIONS) as Array<[keyof ServiceOptions, string]>) {
    const v = Number(process.env[env]);
    if (process.env[env] !== undefined && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return { ...out, ...overrides };
}

const defaultStoreFactory: StoreFactory = async (graphPath) => {
  const store = new LevelGraphStore();
  await store.open(graphPath);
  return store;
};

export async function startDaemon(o: StartDaemonOptions = {}): Promise<DaemonHandle> {
  const options = resolveServiceOptions(o.options);
  const log: Logger = o.log ?? ((m) => process.stderr.write(`${new Date().toISOString()} ${m}\n`));
  const token = randomBytes(32).toString('hex');
  const hub = new EventHub();
  const watchers = new WatcherManager(hub, log, o.watcherFactory);
  const pool = new GraphPool(options, o.storeFactory ?? defaultStoreFactory, (id) => watchers.isWatching(id));
  watchers.attach(pool);

  let shuttingDown: Promise<void> | null = null;
  let server: Server | null = null;
  const writeInfo = o.writeInfo !== false;
  const startedAt = Date.now();
  let lastActivity = Date.now();

  const shutdown = (): Promise<void> => {
    if (shuttingDown) return shuttingDown;
    shuttingDown = (async () => {
      log('[daemon] shutting down');
      clearInterval(sweeper);
      if (writeInfo) removeDaemonInfo(process.pid);
      hub.closeAll();
      await watchers.stopAll();
      await pool.closeAll();
      await new Promise<void>((r) => {
        if (!server) return r();
        server.close(() => r());
        server.closeAllConnections();
      });
      log('[daemon] stopped');
      o.onExit?.();
    })();
    return shuttingDown;
  };

  const registry = o.registry ?? new FileProjectRegistry();
  const deps: ServiceDeps = {
    token, registry, projects: new ProjectCache(registry), pool, watchers, hub, options,
    version: FLOWLENS_VERSION, startedAt, onShutdown: () => void shutdown(), log,
    onActivity: () => { lastActivity = Date.now(); },
    sessions: new SessionStore(),
  };
  const app = createServiceApp(deps, o.mount === undefined ? mountExplorer : o.mount ?? undefined);

  const fastRpc = createRpcFastPath(deps);
  server = createServer((req, res) => {
    if (!fastRpc(req, res)) app(req, res);
  });
  const wanted = preferredDaemonPort(o.port);
  try {
    await listenOn(server, wanted);
  } catch (err) {
    if (wanted === 0 || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    await listenOn(server, 0);
  }
  server.keepAliveTimeout = 65_000;
  const port = (server.address() as AddressInfo).port;
  deps.port = port;

  const sweeper = setInterval(() => {
    void pool.sweep().catch((err: unknown) => log(`[sweep] ${(err as Error).message}`));
    if (pool.busy() || hub.subscriberCount() > 0) lastActivity = Date.now();
    if (options.exitWhenIdleMs > 0 && Date.now() - lastActivity > options.exitWhenIdleMs) {
      log('[daemon] idle — exiting');
      void shutdown();
    }
  }, Math.max(250, Math.min(5_000, options.leaseTtlMs / 4))).unref();

  const info: DaemonInfo = {
    pid: process.pid, host: DAEMON_HOST, port, token,
    version: FLOWLENS_VERSION, started_at: new Date(startedAt).toISOString(),
  };
  if (writeInfo) writeDaemonInfo(info);
  log(`[daemon] listening on ${DAEMON_HOST}:${port} (pid ${process.pid}, v${FLOWLENS_VERSION})`);
  return { info, app, server, deps, shutdown };
}
