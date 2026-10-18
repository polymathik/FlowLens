/**
 * How a file takes part in community detection.
 *
 *  - `cluster`: source code; nodes of the graph that gets partitioned.
 *  - `attach`: tests, docs, assets and generated files; never shape a community, they join the
 *    community of the files they depend on most (see `attach.ts`).
 *  - `config`: config files and lockfiles; they go to the Config zone (or their package zone).
 */
import type { Hierarchy, HierarchyNode } from '../../../contracts/hierarchy.js';
import { isConfigRole } from '../../hierarchy/file-role.js';

export type Treatment = 'cluster' | 'attach' | 'config';

const GENERATED = /(?:^|\/)(?:generated|__generated__|\.generated)\/|\.(?:generated|gen|pb|min)\.[a-z]+$|_pb2(?:_grpc)?\.pyi?$|\.pb\.go$|\.g\.dart$/i;

export const isGeneratedPath = (path: string): boolean => GENERATED.test(path);

export function treatmentOf(node: HierarchyNode): Treatment {
  if (node.role !== undefined && isConfigRole(node.role)) return 'config';
  if (node.role === 'test' || node.role === 'docs' || node.role === 'asset' || isGeneratedPath(node.path)) return 'attach';
  return 'cluster';
}

/** The nearest enclosing workspace package node id, or null for files outside any package. */
export function packageOf(h: Hierarchy, node: HierarchyNode): string | null {
  for (let p = node.parentId ? h.nodes.get(node.parentId) : undefined; p; p = p.parentId ? h.nodes.get(p.parentId) : undefined) {
    if (p.kind === 'package') return p.id;
  }
  return null;
}

/** The file node a graph reference stands for: a file itself or the file that holds a symbol. */
export function fileOfRef(h: Hierarchy, ref: string): string | null {
  const id = h.nodes.has(ref) ? ref : h.byEntity.get(ref) ?? h.byFile.get(ref.replace(/\\/g, '/'));
  const node = id ? h.nodes.get(id) : undefined;
  if (!node) return null;
  if (node.kind === 'file') return node.id;
  if (node.kind === 'symbol') return h.byFile.get(node.path) ?? null;
  return null;
}
