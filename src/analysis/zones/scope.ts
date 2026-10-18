/** Scope handling shared by the strategies: resolve the node being zoned and walk its files. */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode } from '../../contracts/hierarchy.js';
import { isConfigRole } from '../hierarchy/file-role.js';
import { resolveRef } from '../hierarchy/query.js';

const CONTAINER_KINDS: ReadonlySet<string> = new Set(['project', 'package', 'folder', 'config']);

/** The node to zone (default the project), or null when unknown or not a container. */
export function scopeNodeOf(h: Hierarchy, scopeId?: string): HierarchyNode | null {
  const id = scopeId === undefined || scopeId === '' ? PROJECT_NODE_ID : resolveRef(h, scopeId);
  const node = id ? h.nodes.get(id) : undefined;
  return node && CONTAINER_KINDS.has(node.kind) ? node : null;
}

export const isFileNode = (n: HierarchyNode): boolean => n.kind === 'file';
export const isConfigFile = (n: HierarchyNode): boolean => n.kind === 'file' && n.role !== undefined && isConfigRole(n.role);
export const isFolderish = (n: HierarchyNode): boolean => n.kind === 'folder' || n.kind === 'package';

/** Every file node below `node` (symbols excluded), in hierarchy order. */
export function filesBelow(h: Hierarchy, node: HierarchyNode): string[] {
  const out: string[] = [];
  const stack = [node];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.kind === 'file') {
      out.push(cur.id);
      continue;
    }
    for (let i = cur.childIds.length - 1; i >= 0; i--) {
      const child = h.nodes.get(cur.childIds[i]);
      if (child && child.kind !== 'symbol') stack.push(child);
    }
  }
  return out;
}

/** Display label for the zone holding the files directly in the scope root. */
export const rootLabel = (scope: HierarchyNode): string => (scope.kind === 'project' ? 'Root' : scope.name);
/** Key of that zone: the scope's directory (`.` for the project). */
export const rootKey = (scope: HierarchyNode): string => scope.path || '.';
