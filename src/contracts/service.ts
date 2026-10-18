/**
 * Graph service (daemon) contract — Phase 9 / Lane B.
 *
 * One local FlowLens daemon owns every registered project's LevelDB graph
 * (LevelDB allows a single process per database). Every other surface —
 * `serve` (stdio MCP), `watch`, `check`, `index`, `init`, agent hooks and
 * the explorer UI — talks to it over HTTP on 127.0.0.1 through
 * `RemoteGraphStore`, which implements the ordinary `GraphStore` contract.
 *
 * Discovery: the daemon binds an ephemeral port on 127.0.0.1 and writes
 * `$FLOWLENS_HOME/daemon.json` (mode 0600) with pid, port, token and
 * version. Every request must carry `Authorization: Bearer <token>`
 * (the SSE route also accepts `?access_token=` because browsers'
 * EventSource cannot set headers — RFC 6750 §2.3).
 *
 * All graph routes are namespaced by project id (== manifest project_id ==
 * registry ProjectRecord.id).
 */
import type { GraphStore } from './graph.js';
import type { GraphManifest } from './manifest.js';
import type { ProjectWithStatus } from './projects.js';

/* ---------------- discovery ---------------- */

export const DAEMON_INFO_FILE = 'daemon.json';
export const DAEMON_LOG_FILE = 'daemon.log';
export const DAEMON_HOST = '127.0.0.1';
/** Set to `1` to bypass the daemon and open LevelDB directly (tests/CI). */
export const NO_DAEMON_ENV = 'FLOWLENS_NO_DAEMON';

export interface DaemonInfo {
  pid: number;
  host: typeof DAEMON_HOST;
  port: number;
  /** 256-bit random hex bearer token. */
  token: string;
  /** FlowLens package version the daemon runs. */
  version: string;
  started_at: string;
}

/* ---------------- routes ---------------- */

/** Route templates; `:id` is a project id, `:lease` a lease id. */
export const SERVICE_ROUTES = {
  ping: '/api/ping', // GET  → PingResponse
  version: '/api/version', // GET  → VersionResponse
  shutdown: '/api/shutdown', // POST → { ok: true }
  projects: '/api/projects', // GET  → ProjectDetail[]
  resolve: '/api/projects/resolve', // POST ResolveProjectRequest → ProjectWithStatus
  project: '/api/projects/:id', // GET  → ProjectDetail
  rpc: '/api/projects/:id/rpc', // POST GraphRpcRequest → GraphRpcResponse
  leases: '/api/projects/:id/leases', // POST LeaseRequest → LeaseResponse
  lease: '/api/projects/:id/leases/:lease', // PUT (renew) / DELETE (release)
  close: '/api/projects/:id/close', // POST → { ok: true } (evict: stop watcher, close DB)
  events: '/api/projects/:id/events', // GET  → text/event-stream of ServiceEvent
} as const;

/** Fill a route template: `routePath(SERVICE_ROUTES.rpc, { id })`. */
export function routePath(template: string, params: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
}

/* ---------------- graph RPC ---------------- */

/** Every GraphStore method except the lifecycle pair (open/close is leases). */
export type GraphRpcMethod = Exclude<keyof GraphStore, 'open' | 'close'>;

export const GRAPH_READ_METHODS = [
  'getNode', 'getNodesByKind', 'getNodesByFile',
  'getEdgesFrom', 'getEdgesTo', 'getAllNodes', 'getAllEdges',
  'getUnresolvedRelations',
] as const satisfies readonly GraphRpcMethod[];

/** Writes are serialized per project inside the daemon. */
export const GRAPH_WRITE_METHODS = [
  'putNode', 'deleteNode', 'deleteNodesByFile', 'putEdge', 'deleteEdge',
  'deleteEdgesByFile', 'putNodes', 'putEdges', 'clear',
  'replaceFile',
] as const satisfies readonly GraphRpcMethod[];

export interface GraphRpcRequest<M extends GraphRpcMethod = GraphRpcMethod> {
  method: M;
  args: Parameters<NonNullable<GraphStore[M]>>;
}

export interface GraphRpcSuccess<M extends GraphRpcMethod = GraphRpcMethod> {
  ok: true;
  result: Awaited<ReturnType<NonNullable<GraphStore[M]>>> | null;
}

export type GraphRpcResponse<M extends GraphRpcMethod = GraphRpcMethod> =
  | GraphRpcSuccess<M>
  | ServiceErrorBody;

/* ---------------- projects ---------------- */

export interface ResolveProjectRequest {
  /** Project root (any form; the daemon canonicalises with realpath). */
  root: string;
  /** Register when unknown (default true). */
  register?: boolean;
}

export interface ProjectGraphState {
  open: boolean;
  leases: number;
  watching: boolean;
  /** ISO time of the last graph request, or null if never used this session. */
  last_used: string | null;
}

export interface ProjectDetail extends ProjectWithStatus {
  manifest: GraphManifest | null;
  graph: ProjectGraphState;
}

/* ---------------- leases ---------------- */

/**
 * A lease says "a client is using this project's graph". While at least one
 * lease is alive the DB stays open (until `idleCloseMs` of inactivity);
 * with no leases and no watcher it is closed after `releaseDelayMs`, so
 * commands that still open LevelDB directly are not locked out. Clients
 * renew every `ttl_ms / 3`; expired leases are dropped.
 */
export interface LeaseRequest {
  /** Also run (or join) the daemon's file watcher for this project. */
  watch?: boolean;
  /** Debounce for a newly started watcher (ms, default 300). */
  debounce_ms?: number;
  /** Free-form client label for `daemon status`, e.g. "serve". */
  client?: string;
}

export interface LeaseResponse {
  ok: true;
  lease_id: string;
  ttl_ms: number;
  project_id: string;
}

/* ---------------- events (SSE) ---------------- */

export interface GraphChangedEvent {
  type: 'graph-changed';
  project_id: string;
  /** `watch` = daemon watcher applied file events; `rpc` = a client wrote. */
  source: 'watch' | 'rpc';
  files_reparsed: number;
  files_deleted: number;
  /** Relative paths touched (watch source only; capped at 50). */
  paths: string[];
  errors: Array<{ path: string; message: string }>;
  duration_ms: number;
  at: string;
}

export interface HelloEvent {
  type: 'hello';
  project_id: string;
  at: string;
}

export type ServiceEvent = GraphChangedEvent | HelloEvent;

/* ---------------- misc responses ---------------- */

export interface PingResponse {
  ok: true;
  pid: number;
  version: string;
  uptime_ms: number;
}

export interface VersionResponse {
  ok: true;
  version: string;
  /** Bumped when this contract changes incompatibly. */
  api_version: 1;
}

/* ---------------- errors ---------------- */

export type ServiceErrorCode =
  | 'unauthorized' // missing/wrong bearer token (401)
  | 'forbidden_host' // Host header not 127.0.0.1/localhost (403, DNS-rebinding guard)
  | 'not_found' // unknown route or project id (404)
  | 'bad_request' // invalid body / method / args (400)
  | 'project_missing' // project root or .flowlens/ gone (409)
  | 'graph_locked' // another process holds the LevelDB lock (423)
  | 'shutting_down' // daemon is stopping (503)
  | 'internal'; // anything else (500)

export interface ServiceErrorBody {
  ok: false;
  error: { code: ServiceErrorCode; message: string };
}

export const SERVICE_ERROR_STATUS: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden_host: 403,
  not_found: 404,
  bad_request: 400,
  project_missing: 409,
  graph_locked: 423,
  shutting_down: 503,
  internal: 500,
};

/* ---------------- tuning ---------------- */

export interface ServiceOptions {
  /** Close a project's DB after this long without requests (default 10 min). */
  idleCloseMs: number;
  /** Close an unleased, unwatched DB this long after its last use (default 0). */
  releaseDelayMs: number;
  /** Max simultaneously open project DBs; least-recently-used is closed (default 16). */
  maxOpenProjects: number;
  /** Lease time-to-live without renewal (default 60 s). */
  leaseTtlMs: number;
  /** Debounce for graph-changed events caused by RPC writes (default 500 ms). */
  rpcEventDebounceMs: number;
  /** Exit when nothing is leased, watched or subscribed for this long (default 1 h; 0 = never). */
  exitWhenIdleMs: number;
}

export const DEFAULT_SERVICE_OPTIONS: ServiceOptions = {
  idleCloseMs: 10 * 60_000,
  releaseDelayMs: 0,
  maxOpenProjects: 16,
  leaseTtlMs: 60_000,
  rpcEventDebounceMs: 500,
  exitWhenIdleMs: 60 * 60_000,
};
