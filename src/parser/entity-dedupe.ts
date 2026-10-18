/**
 * Same-file duplicate declarations.
 *
 * Languages allow several declarations that map to one qualified name:
 * overloads (Java/Kotlin/C#/C++), redefinitions and property setters
 * (Python), TS declaration merging of the same kind. Entity ids are a hash
 * of (file, qualified name, kind), so these would silently overwrite each
 * other in the store. We keep the first declaration explicitly and count the
 * rest, so the count is visible in the manifest instead of hidden.
 */
import type { Entity } from '../contracts/entities.js';

export function dedupeEntities(entities: Entity[]): { entities: Entity[]; duplicates: number } {
  const seen = new Set<string>();
  const out: Entity[] = [];
  let duplicates = 0;
  for (const e of entities) {
    if (seen.has(e.id)) {
      duplicates++;
      continue;
    }
    seen.add(e.id);
    out.push(e);
  }
  return { entities: out, duplicates };
}
