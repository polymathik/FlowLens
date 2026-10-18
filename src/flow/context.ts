/**
 * FlowContext — everything a flow query needs, built once per graph load:
 * the indexed FlowGraph, a source reader rooted at the project, the workspace
 * packages (for lanes) and the detected entry points (lazy, memoised).
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { EntryPoint } from '../contracts/flow.js';
import type { GraphStore } from '../contracts/graph.js';
import type { PackageInfo } from '../contracts/hierarchy.js';
import { selectPackages } from '../analysis/hierarchy/packages.js';
import { computeWorkspace } from '../canvas/api/workspace.js';
import { detectEntryPoints } from './entry-points.js';
import { FlowGraph } from './graph.js';
import type { SourceProvider } from './source.js';

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Reads a repo-relative file from `rootDir` (never outside it, never huge); undefined on any problem. */
export function fsSource(rootDir: string): SourceProvider {
  const root = resolve(rootDir);
  return (file) => {
    try {
      const abs = resolve(join(root, file));
      if (abs !== root && !abs.startsWith(root + sep)) return undefined;
      if (statSync(abs).size > MAX_SOURCE_BYTES) return undefined;
      return readFileSync(abs, 'utf-8');
    } catch {
      return undefined;
    }
  };
}

export interface FlowContext {
  graph: FlowGraph;
  source: SourceProvider;
  packages: PackageInfo[];
  projectName: string;
  /** Every detected entry point (tests included); cached. */
  entries(): EntryPoint[];
}

export interface FlowContextInit {
  rootDir: string;
  packages?: PackageInfo[];
  projectName?: string;
  source?: SourceProvider;
  log?: (line: string) => void;
}

export function createFlowContext(graph: FlowGraph, init: FlowContextInit): FlowContext {
  const source = init.source ?? fsSource(init.rootDir);
  return {
    graph, source, packages: init.packages ?? [], projectName: init.projectName ?? '',
    entries: () => graph.memoize('flow:entries', () => detectEntryPoints(graph, source, {
      onError: (name, err) => init.log?.(`[flow] entry-point detector '${name}' failed: ${err instanceof Error ? err.message : String(err)}`),
    })),
  };
}

/** Workspace packages of a project (reads the manifests among the indexed files). */
export async function loadPackages(store: GraphStore, rootDir: string): Promise<{ packages: PackageInfo[]; projectName: string }> {
  try {
    const ws = await computeWorkspace(store, rootDir);
    return { packages: selectPackages(ws.manifests, ws.workspace_globs), projectName: ws.project_name ?? '' };
  } catch {
    return { packages: [], projectName: '' };
  }
}

/** Build a context from a store: loads entities, relations (incl. unresolved) and packages. */
export async function buildFlowContext(store: GraphStore, rootDir: string, init: Partial<FlowContextInit> = {}): Promise<FlowContext> {
  const [entities, relations, unresolved, ws] = await Promise.all([
    store.getAllNodes(), store.getAllEdges(), store.getUnresolvedRelations?.() ?? Promise.resolve([]), loadPackages(store, rootDir),
  ]);
  return createFlowContext(new FlowGraph({ entities, relations, unresolved }), { rootDir, ...ws, ...init });
}
