/**
 * The ONE place agent commands open the graph. Wave 2 (Lane B graph service)
 * swaps the body of `openAgentGraph` for `openGraphStore(root)`; nothing else
 * in src/agent/ touches LevelGraphStore directly.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Entity } from '../contracts/entities.js';
import type { GraphStore } from '../contracts/graph.js';
import type { Relation } from '../contracts/relations.js';
import type { AgentGraphUnavailable } from '../contracts/agent.js';
import { LevelGraphStore } from '../graph/levelgraph-store.js';

export interface AgentGraphHandle {
  ok: true;
  graph: GraphStore;
  flowlensDir: string;
  close(): Promise<void>;
}

export type AgentGraphResult = AgentGraphHandle | AgentGraphUnavailable;

export const SETUP_HINT = 'FlowLens context unavailable: no .flowlens/ graph in this project. Run `flowlens init` and `flowlens index` first.';
export const BUSY_HINT = 'FlowLens context unavailable: another FlowLens process (e.g. `flowlens serve`, `watch` or `canvas`) holds the graph lock. Stop it or wait for it to finish, then retry; the multi-process graph service (Phase 9) removes this limitation.';

export function flowlensDirFor(rootDir: string): string {
  return join(rootDir, '.flowlens');
}

export async function openAgentGraph(
  rootDir: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<AgentGraphResult> {
  const flowlensDir = flowlensDirFor(rootDir);
  if (!existsSync(join(flowlensDir, 'graph'))) {
    return { ok: false, reason: 'missing', message: SETUP_HINT };
  }
  const store = new LevelGraphStore();
  const attempts = options.attempts ?? 6;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await store.open(join(flowlensDir, 'graph'));
      const graph = memoizeGraphScans(store);
      return { ok: true, graph, flowlensDir, close: () => store.close() };
    } catch (err) {
      lastError = err;
      if (!isLockError(err)) break;
      await delay(options.delayMs ?? 150);
    }
  }
  return isLockError(lastError)
    ? { ok: false, reason: 'busy', message: BUSY_HINT }
    : { ok: false, reason: 'error', message: `FlowLens context unavailable: cannot open the graph (${describe(lastError)}).` };
}

function isLockError(err: unknown): boolean {
  const text = `${describe(err)} ${(err as { code?: string })?.code ?? ''} ${describe((err as { cause?: unknown })?.cause)}`;
  return /lock|LEVEL_DATABASE_NOT_OPEN|resource temporarily unavailable|EAGAIN/i.test(text);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

/**
 * Per-invocation memo of full-graph scans. Context building, cycle detection
 * and architecture validation each call getAllNodes/getAllEdges; on a 10K-file
 * LevelGraph each scan costs seconds, so one invocation shares one scan.
 * Any write invalidates the memo (the guard re-indexes, then re-reads).
 */
export function memoizeGraphScans(inner: GraphStore): GraphStore {
  let nodes: Promise<Entity[]> | null = null;
  let edges: Promise<Relation[]> | null = null;
  const invalidate = () => { nodes = null; edges = null; };
  const writes = new Set([
    'putNode', 'putNodes', 'deleteNode', 'deleteNodesByFile',
    'putEdge', 'putEdges', 'deleteEdge', 'deleteEdgesByFile', 'clear', 'open',
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
