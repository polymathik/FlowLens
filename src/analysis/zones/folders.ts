/**
 * `folders` strategy: nested zones mirroring the hierarchy's collapsed folders.
 *
 * A folder / package node becomes a zone when it directly holds at least
 * one file or has at least two child folders (packages always do). A
 * folder that is only a bridge to a single child folder is skipped, its
 * child moves up. Zones nest up to `maxDepth` levels below the scope;
 * deeper folders are merged into their depth-cap ancestor, which then
 * starts collapsed (`absorbed`).
 *
 * Files directly in the scope root form the `Root` zone; the scope's own
 * config group (config files, lockfiles) forms the muted `Config` zone.
 * Config files deeper down stay with their folder.
 */
import type { Hierarchy, HierarchyNode } from '../../contracts/hierarchy.js';
import { ZONE_CONFIG_KEY, ZONE_DEFAULT_MAX_DEPTH, type ZoningInput } from '../../contracts/zones.js';
import { DraftBook, type ZoneDraft } from './draft.js';
import { filesBelow, isFolderish, rootKey, rootLabel, scopeNodeOf } from './scope.js';

/** Files a folder holds itself: its file children plus its config group's files. */
function directFiles(h: Hierarchy, node: HierarchyNode): string[] {
  const out: string[] = [];
  for (const id of node.childIds) {
    const child = h.nodes.get(id);
    if (child?.kind === 'file') out.push(child.id);
    else if (child?.kind === 'config') out.push(...child.childIds.filter((c) => h.nodes.get(c)?.kind === 'file'));
  }
  return out;
}

export function foldersDrafts(input: ZoningInput): ZoneDraft[] {
  const h = input.hierarchy;
  const scope = scopeNodeOf(h, input.scopeId);
  if (!scope) return [];
  const maxDepth = Math.max(1, Math.floor(input.options?.maxDepth ?? ZONE_DEFAULT_MAX_DEPTH));
  const book = new DraftBook();

  const visit = (node: HierarchyNode, parentKey: string | null, level: number): void => {
    const files = directFiles(h, node);
    const subs = node.childIds.map((id) => h.nodes.get(id)).filter((n): n is HierarchyNode => !!n && isFolderish(n));
    const worthy = node.kind === 'package' ? files.length + subs.length > 0 : files.length >= 1 || subs.length >= 2;
    if (!worthy) {
      for (const sub of subs) visit(sub, parentKey, level); // a bridge folder adds no level
      return;
    }
    const draft = book.add({
      key: node.path, label: node.name, source: node.kind === 'package' ? 'package' : 'folder', parentKey, fileIds: files, nodeId: node.id,
    });
    if (level >= maxDepth) {
      for (const sub of subs) draft.fileIds.push(...filesBelow(h, sub));
      draft.absorbed = subs.length > 0;
      return;
    }
    for (const sub of subs) visit(sub, draft.key, level + 1);
  };

  for (const id of scope.childIds) {
    const child = h.nodes.get(id);
    if (!child) continue;
    if (child.kind === 'file') {
      book.ensure(rootKey(scope), () => ({ label: rootLabel(scope), source: 'folder', parentKey: null })).fileIds.push(child.id);
    } else if (child.kind === 'config') {
      book.ensure(ZONE_CONFIG_KEY, () => ({ label: 'Config', source: 'config', parentKey: null })).fileIds.push(...filesBelow(h, child));
    } else if (isFolderish(child)) visit(child, null, 1);
  }
  return book.list();
}
