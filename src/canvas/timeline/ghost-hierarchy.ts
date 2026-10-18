/**
 * Ghost cards: files that were deleted before today have no node in the
 * hierarchy, but the timeline wants to show them while they existed. They
 * are added to a COPY of the hierarchy, each below the deepest folder or
 * package that still exists on its path (so the zones — packages, folders —
 * that hold them today also hold them in the past). A file whose whole
 * folder is gone, with no folder left on its path, goes to a synthetic
 * "Deleted" folder at the project root.
 *
 * The layout is then computed once from today's files plus these ghosts and
 * never again while the timeline plays. At most `GHOST_CAP` ghosts are
 * added (those with the most commits first); the rest are only counted.
 */
import { PROJECT_NODE_ID, type Hierarchy, type HierarchyNode } from '../../contracts/hierarchy.js';
import { fileNodeId, folderId } from '../../analysis/hierarchy/ids.js';
import { dirnameOf } from '../../analysis/module-path.js';
import type { Lives } from './lives.js';

export const GHOST_CAP = 300;
export const DELETED_DIR = '__deleted__';
export const DELETED_LABEL = 'Deleted';

/** Card paths of lives that have no node in `h` (deleted files), most-touched first, capped. */
export function ghostPaths(h: Hierarchy, lives: Lives): { paths: string[]; dropped: number } {
  const missing = [...lives.values()].filter((l) => !h.byFile.has(l.path));
  missing.sort((a, b) => b.changes.length - a.changes.length || (a.path < b.path ? -1 : 1));
  return { paths: missing.slice(0, GHOST_CAP).map((l) => l.path), dropped: Math.max(0, missing.length - GHOST_CAP) };
}

const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Nearest existing folder / package node on the path of `path` (the project root when none). */
function parentFor(h: Hierarchy, path: string): string {
  let dir = dirnameOf(path);
  if (dir === '.') dir = '';
  while (dir) {
    const id = h.byDir.get(dir);
    if (id && h.nodes.has(id)) return id;
    dir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  }
  return PROJECT_NODE_ID;
}

/** A copy of `h` with a file node for every path in `paths`. Returns `h` itself when there is nothing to add. */
export function withGhosts(h: Hierarchy, paths: readonly string[]): Hierarchy {
  if (paths.length === 0) return h;
  const nodes = new Map(h.nodes);
  const byFile = new Map(h.byFile);
  const byDir = new Map(h.byDir);
  const children = new Map<string, string[]>();
  const attach = (parentId: string, id: string): void => {
    const list = children.get(parentId) ?? [...nodes.get(parentId)!.childIds];
    list.push(id);
    children.set(parentId, list);
  };
  let deleted: HierarchyNode | null = null;
  for (const path of paths) {
    const id = fileNodeId(path);
    if (nodes.has(id)) continue;
    let parentId = parentFor(h, path);
    if (parentId === PROJECT_NODE_ID && path.includes('/')) {
      if (!deleted) {
        const root = nodes.get(PROJECT_NODE_ID)!;
        deleted = {
          id: folderId(DELETED_DIR), kind: 'folder', name: DELETED_LABEL, path: DELETED_DIR, parentId: PROJECT_NODE_ID, childIds: [],
          depth: root.depth + 1, stats: { files: 0, folders: 0, symbols: 0, lines: 0 },
        };
        nodes.set(deleted.id, deleted);
        byDir.set(DELETED_DIR, deleted.id);
        attach(PROJECT_NODE_ID, deleted.id);
      }
      parentId = deleted.id;
    }
    const parent = nodes.get(parentId)!;
    nodes.set(id, {
      id, kind: 'file', name: baseOf(path), path, parentId, childIds: [], depth: parent.depth + 1,
      stats: { files: 1, folders: 0, symbols: 0, lines: 0 }, role: 'source',
    });
    byFile.set(path, id);
    attach(parentId, id);
  }
  for (const [parentId, childIds] of children) nodes.set(parentId, { ...nodes.get(parentId)!, childIds });
  return { ...h, nodes, byFile, byDir };
}
