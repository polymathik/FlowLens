/**
 * Swimlanes for a trace: nodes grouped by workspace package (when the trace
 * crosses packages) or by folder, using the shared hierarchy
 * (`src/analysis/hierarchy`). The grouping level is coarsened until at most
 * `FLOW_LIMITS.lanes` lanes remain. Lane order = first appearance in call
 * order, so the lanes read left to right as the flow unfolds.
 */
import type { Entity } from '../contracts/entities.js';
import type { FlowLane } from '../contracts/flow.js';
import { FLOW_LIMITS } from '../contracts/flow.js';
import type { Hierarchy, PackageInfo } from '../contracts/hierarchy.js';
import { PROJECT_NODE_ID } from '../contracts/hierarchy.js';
import { buildHierarchy } from '../analysis/hierarchy/build.js';
import { ancestorsOf } from '../analysis/hierarchy/query.js';
import type { FlowGraph } from './graph.js';

export interface LaneResult {
  lanes: FlowLane[];
  laneOf: Map<string, string>;
}

/** Ancestors of a file node: nearest first, project last. */
function chainFor(h: Hierarchy, file: string): string[] {
  const node = h.byFile.get(file);
  return node ? ancestorsOf(h, node) : [PROJECT_NODE_ID];
}

const kindOf = (h: Hierarchy, id: string): FlowLane['kind'] => (h.nodes.get(id)?.kind === 'package' ? 'package' : 'folder');

export function buildLanes(graph: FlowGraph, nodes: Entity[], packages: PackageInfo[] = [], projectName = 'project'): LaneResult {
  const files = [...new Set(nodes.map((n) => n.file))];
  const fileEntities = files.map((f) => graph.fileEntity.get(f)).filter((e): e is Entity => !!e);
  const h = buildHierarchy({ projectName, entities: fileEntities, packages });
  const chains = new Map(files.map((f) => [f, chainFor(h, f)]));

  // Starting level: packages when the trace crosses at least two of them, else the file's folder.
  const pkgOf = (f: string): string | undefined => (chains.get(f) as string[]).find((id) => h.nodes.get(id)?.kind === 'package');
  const crossesPackages = new Set(files.map((f) => pkgOf(f) ?? PROJECT_NODE_ID)).size > 1 && files.some((f) => pkgOf(f));
  let level = new Map<string, string>(files.map((f) => [f, crossesPackages ? (pkgOf(f) ?? PROJECT_NODE_ID) : (chains.get(f) as string[])[0]]));

  // Coarsen (replace each lane by its parent) until the lane count fits.
  for (let guard = 0; guard < 12 && new Set(level.values()).size > FLOW_LIMITS.lanes; guard++) {
    const next = new Map<string, string>();
    for (const [f, id] of level) next.set(f, h.nodes.get(id)?.parentId ?? PROJECT_NODE_ID);
    if ([...next.entries()].every(([f, id]) => level.get(f) === id)) break;
    level = next;
  }

  const laneNodes = new Map<string, string[]>();
  const laneOf = new Map<string, string>();
  for (const n of nodes) {
    const id = level.get(n.file) ?? PROJECT_NODE_ID;
    laneOf.set(n.id, id);
    const list = laneNodes.get(id);
    if (list) list.push(n.id);
    else laneNodes.set(id, [n.id]);
  }
  const lanes: FlowLane[] = [...laneNodes.entries()].map(([id, nodeIds]) => {
    const hn = h.nodes.get(id);
    const isProject = id === PROJECT_NODE_ID;
    return {
      id, kind: isProject ? 'folder' : kindOf(h, id),
      label: isProject ? (projectName || '(root)') : (hn?.name || hn?.path || id),
      path: isProject ? '' : (hn?.path ?? ''), nodeIds,
    };
  });
  return { lanes, laneOf };
}
