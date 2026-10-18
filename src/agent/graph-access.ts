/**
 * The ONE place agent commands open the graph.
 *
 * Wave 2: goes through `openGraphStore(root, { client: 'hook' })`, i.e. the
 * FlowLens daemon by default, so hooks work while `flowlens serve --watch`,
 * `watch` or the explorer are running (they all share the daemon's open
 * LevelDB). `--no-daemon` / `FLOWLENS_NO_DAEMON=1` opens LevelDB directly
 * and can then hit the single-process lock ("busy").
 *
 * The daemon opens a project's DB lazily on the first RPC, so a lock held by
 * a `--no-daemon` process surfaces as `RemoteServiceError('graph_locked')` on
 * the first call, not on `open()`; a cheap probe call forces it here.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Entity } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { Relation } from '../contracts/relations.js';
import type { AgentGraphOptions, AgentGraphUnavailable } from '../contracts/agent.js';
import { HOOK_STORE_TIMEOUTS } from '../contracts/open-graph.js';
import { RemoteServiceError } from '../service/errors.js';
import { daemonDisabled, openGraphStore, type OpenGraphOptions } from '../service/open-graph-store.js';

export interface AgentGraphHandle {
  ok: true;
  graph: GraphStore;
  flowlensDir: string;
  close(): Promise<void>;
}

export type AgentGraphResult = AgentGraphHandle | AgentGraphUnavailable;

export type GraphOpener = (rootDir: string, options: OpenGraphOptions) => Promise<GraphStore>;

export interface OpenAgentGraphOptions extends AgentGraphOptions {
  attempts?: number;
  delayMs?: number;
  /** Injectable for tests; defaults to `openGraphStore`. */
  open?: GraphOpener;
}

export const SETUP_HINT = 'FlowLens context unavailable: no .flowlens/ graph in this project. Run `flowlens init` and `flowlens index` first.';
export const BUSY_HINT_DIRECT = 'FlowLens context unavailable: another FlowLens process holds the graph lock and this command was run with --no-daemon (or FLOWLENS_NO_DAEMON=1). Remove that so hooks share the graph through the FlowLens daemon, or stop the other process.';
export const BUSY_HINT_DAEMON = 'FlowLens context unavailable: another process holds the graph lock outside the FlowLens daemon (a command run with --no-daemon, or an older FlowLens). Stop it; `flowlens daemon status` shows what is using the project.';
/** Kept for callers/tests that refer to the generic busy message. */
export const BUSY_HINT = BUSY_HINT_DIRECT;

/** Id that never exists; `getNode` on it makes the daemon open the DB. */
const PROBE_ID = '__flowlens_agent_probe__';

export function flowlensDirFor(rootDir: string): string {
  return join(rootDir, '.flowlens');
}

export async function openAgentGraph(
  rootDir: string,
  options: OpenAgentGraphOptions = {},
): Promise<AgentGraphResult> {
  const flowlensDir = flowlensDirFor(rootDir);
  if (!existsSync(join(flowlensDir, 'graph'))) {
    return { ok: false, reason: 'missing', message: SETUP_HINT };
  }
  const open = options.open ?? openGraphStore;
  const attempts = options.attempts ?? 6;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let store: GraphStore | null = null;
    try {
      store = await open(rootDir, { client: 'hook', daemon: options.daemon, ...HOOK_STORE_TIMEOUTS });
      await store.getNode(PROBE_ID);
      const opened = store;
      return { ok: true, graph: memoizeGraphScans(opened), flowlensDir, close: () => opened.close() };
    } catch (err) {
      lastError = err;
      await store?.close().catch(() => undefined);
      if (!isGraphLockedError(err)) break;
      await delay(options.delayMs ?? 150);
    }
  }
  return describeGraphFailure(lastError, options);
}

/** Map any graph failure (open or mid-use) to an explicit "unavailable" result. */
export function describeGraphFailure(err: unknown, options: AgentGraphOptions = {}): AgentGraphUnavailable {
  if (isGraphLockedError(err)) {
    const direct = daemonDisabled({ daemon: options.daemon });
    return { ok: false, reason: 'busy', message: direct ? BUSY_HINT_DIRECT : BUSY_HINT_DAEMON };
  }
  const daemonHint = daemonDisabled({ daemon: options.daemon })
    ? ''
    : ' If the FlowLens daemon cannot start here, `flowlens daemon status` shows why; `--no-daemon` opens the graph directly.';
  return {
    ok: false,
    reason: 'error',
    message: `FlowLens context unavailable: cannot read the graph (${describe(err)}).${daemonHint}`,
  };
}

/**
 * LevelDB "already locked", directly (`--no-daemon`) or reported by the daemon
 * (`graph_locked`, when some other process opened the DB without it).
 */
export function isGraphLockedError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    if (e instanceof RemoteServiceError) return e.code === 'graph_locked';
    const x = e as { code?: string; message?: string; cause?: unknown };
    if (x.code === 'LEVEL_LOCKED') return true;
    if (/\bLOCK\b|lock hold|locked|resource temporarily unavailable|EAGAIN/i.test(x.message ?? '')) return true;
    e = x.cause;
  }
  return false;
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err ?? 'unknown error');
  const cause = (err as Error & { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
}

/**
 * Per-invocation memo of full-graph scans. Context building, cycle detection
 * and architecture validation each call getAllNodes/getAllEdges; on a 10K-file
 * graph each scan costs seconds (and is one large RPC through the daemon), so
 * one invocation shares one scan. Any write invalidates the memo (the guard
 * re-indexes, then re-reads).
 */
export function memoizeGraphScans(inner: GraphStore): GraphStore {
  let nodes: Promise<Entity[]> | null = null;
  let edges: Promise<Relation[]> | null = null;
  const invalidate = () => { nodes = null; edges = null; };
  const writes = new Set([
    'putNode', 'putNodes', 'deleteNode', 'deleteNodesByFile',
    'putEdge', 'putEdges', 'deleteEdge', 'deleteEdgesByFile', 'clear', 'open',
    'replaceFile', 'reindex',
  ]);
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'getAllNodes') return () => (nodes ??= target.getAllNodes());
      if (prop === 'getAllEdges') return () => (edges ??= target.getAllEdges());
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && writes.has(prop)) {
        return (...args: unknown[]) => {
          invalidate();
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}
