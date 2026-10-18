/**
 * Symbol nesting inside a file: members hang under their class / namespace,
 * derived from `qualified_name = {file}/{Scope.Path}.{name}` (Phase 8
 * identity rules), so it needs no relation data.
 */
import type { HierarchyEntity } from '../../contracts/hierarchy.js';

/** Entity kinds that are not shown as symbol nodes. */
export const SKIPPED_SYMBOL_KINDS: ReadonlySet<string> = new Set(['parameter', 'enum_member', 'decorator', 'file', 'module']);

export const isSymbolEntity = (e: HierarchyEntity): boolean => !SKIPPED_SYMBOL_KINDS.has(e.kind) && !!e.file;

/** Stable order inside a file: source order, then name, then id. */
export function compareSymbols(a: HierarchyEntity, b: HierarchyEntity): number {
  return (
    (a.location?.line_start ?? 0) - (b.location?.line_start ?? 0) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Parent entity id of every symbol in one file (`null` = the file itself).
 * Walks up the dotted scope until an existing declaration is found.
 */
export function symbolParents(file: string, symbols: HierarchyEntity[]): Map<string, string | null> {
  const byQn = new Map<string, string>();
  for (const s of symbols) if (!byQn.has(s.qualified_name)) byQn.set(s.qualified_name, s.id);
  const prefix = `${file}/`;
  const out = new Map<string, string | null>();
  for (const s of symbols) {
    let parent: string | null = null;
    if (s.qualified_name.startsWith(prefix)) {
      const parts = s.qualified_name.slice(prefix.length).split('.');
      for (let n = parts.length - 1; n >= 1 && parent === null; n--) {
        const candidate = byQn.get(prefix + parts.slice(0, n).join('.'));
        if (candidate && candidate !== s.id) parent = candidate;
      }
    }
    out.set(s.id, parent);
  }
  return out;
}
