/** Read-only lookups over a built `Hierarchy` (pure). */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode } from '../../contracts/hierarchy.js';

export const getNode = (h: Hierarchy, id: string): HierarchyNode | undefined => h.nodes.get(id);

/** Ancestors from the parent up to (and including) the project root. */
export function ancestorsOf(h: Hierarchy, id: string): string[] {
  const out: string[] = [];
  let cur = h.nodes.get(id)?.parentId ?? null;
  while (cur) {
    out.push(cur);
    cur = h.nodes.get(cur)?.parentId ?? null;
  }
  return out;
}

/** Path from the root to the node, root excluded, node included (the drill path that OPENS the node). */
export function pathTo(h: Hierarchy, id: string): string[] {
  if (id === PROJECT_NODE_ID || !h.nodes.has(id)) return [];
  return [...ancestorsOf(h, id).reverse().slice(1), id];
}

/** Deepest-first chain `[node, parent, …]`, root excluded. */
export function chainOf(h: Hierarchy, id: string): string[] {
  return h.nodes.has(id) && id !== PROJECT_NODE_ID ? pathTo(h, id).reverse() : [];
}

export const isContainer = (h: Hierarchy, id: string): boolean => (h.nodes.get(id)?.childIds.length ?? 0) > 0;

/**
 * Resolve any graph reference to a node id: a node id, an entity id, a file
 * path or a directory path (module). Null when unknown.
 */
export function resolveRef(h: Hierarchy, ref: string): string | null {
  if (!ref) return null;
  if (h.nodes.has(ref)) return ref;
  const viaEntity = h.byEntity.get(ref);
  if (viaEntity) return viaEntity;
  const p = ref.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return h.byFile.get(p) ?? h.byDir.get(p) ?? h.byQualifiedName.get(p) ?? null;
}

/** Node for a deep-link path identifier ('.' = project; dir, file, qualified name or node id). */
export function resolvePathIdentifier(h: Hierarchy, identifier: string): string | null {
  return identifier === '.' || identifier === '' ? PROJECT_NODE_ID : resolveRef(h, identifier);
}

/** Identifier used in `#/p/<id>/map/path/<identifier>` for a node (inverse of `resolvePathIdentifier`). */
export function pathIdentifierOf(h: Hierarchy, id: string): string {
  const n = h.nodes.get(id);
  if (!n || n.kind === 'project') return '.';
  if (n.kind === 'package' || n.kind === 'folder' || n.kind === 'file') return n.path;
  return n.kind === 'symbol' && n.qualifiedName ? n.qualifiedName : id;
}

/** Common ancestor path length of two root-excluded paths. */
export function commonPrefixLength(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
