/**
 * `packages` strategy: workspace packages are hard boundaries.
 *
 *  - one zone per package (named by its manifest name; nested in the enclosing package, if any);
 *  - one zone per top-level directory of the scope that is not in a package
 *    (the hierarchy's collapsed folder, e.g. `docs`, `scripts`);
 *  - `Root`: files directly in the scope root;
 *  - `Config`: every config / lockfile outside a package (roles from the hierarchy).
 *
 * Zones are flat (no folder nesting): the `folders` mode shows the inside.
 */
import type { Hierarchy, HierarchyNode } from '../../contracts/hierarchy.js';
import { ZONE_CONFIG_KEY, type ZoningInput } from '../../contracts/zones.js';
import { DraftBook, type ZoneDraft } from './draft.js';
import { claimKey } from './keys.js';
import { isConfigFile, rootKey, rootLabel, scopeNodeOf } from './scope.js';

interface Walk {
  /** Key of the nearest enclosing package zone. */
  pkg: string | null;
  /** The scope's direct child on the way down (null while at the scope itself). */
  top: HierarchyNode | null;
}

export function packagesDrafts(input: ZoningInput): ZoneDraft[] {
  const h: Hierarchy = input.hierarchy;
  const scope = scopeNodeOf(h, input.scopeId);
  if (!scope) return [];
  const book = new DraftBook();
  const used = new Set<string>([ZONE_CONFIG_KEY, rootKey(scope)]);

  // Pass 1: claim package keys first so a directory can never steal a package's name.
  const pkgKey = new Map<string, string>();
  const stack: HierarchyNode[] = [scope];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (let i = cur.childIds.length - 1; i >= 0; i--) {
      const child = h.nodes.get(cur.childIds[i]);
      if (!child || child.kind === 'file' || child.kind === 'symbol') continue;
      if (child.kind === 'package') pkgKey.set(child.id, claimKey(used, child.name, `${child.name}@${child.path}`));
      stack.push(child);
    }
  }

  const configDraft = (): ZoneDraft =>
    book.ensure(ZONE_CONFIG_KEY, () => ({ label: 'Config', source: 'config', parentKey: null }));
  const rootDraft = (): ZoneDraft =>
    book.ensure(rootKey(scope), () => ({ label: rootLabel(scope), source: 'folder', parentKey: null }));
  const dirKeys = new Map<string, string>();
  const dirDraft = (top: HierarchyNode): ZoneDraft => {
    let key = dirKeys.get(top.id);
    if (!key) dirKeys.set(top.id, (key = claimKey(used, top.path, `dir:${top.path}`)));
    return book.ensure(key, () => ({ label: top.name, source: 'folder', parentKey: null, nodeId: top.id }));
  };

  // Pass 2: place every file.
  const visit = (node: HierarchyNode, w: Walk): void => {
    for (const id of node.childIds) {
      const child = h.nodes.get(id);
      if (!child || child.kind === 'symbol') continue;
      if (child.kind === 'file') {
        const draft = w.pkg ? book.get(w.pkg)! : isConfigFile(child) ? configDraft() : w.top ? dirDraft(w.top) : rootDraft();
        draft.fileIds.push(child.id);
        continue;
      }
      if (child.kind === 'package') {
        const key = pkgKey.get(child.id)!;
        book.add({ key, label: child.name, source: 'package', parentKey: w.pkg, nodeId: child.id });
        visit(child, { pkg: key, top: w.top ?? child });
      } else {
        visit(child, { pkg: w.pkg, top: w.top ?? child });
      }
    }
  };
  visit(scope, { pkg: null, top: null });
  return book.list();
}
