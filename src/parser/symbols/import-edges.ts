/**
 * Import edges derived from import bindings (shared by non-TS extractors).
 *
 * - a binding resolved to a file → direct file→file `import` edge,
 * - a project-internal binding that names no file → explicit unresolved
 *   import (`final`, never a fabricated id),
 * - a named binding (not a namespace) → optional pending import to the file
 *   that *declares* the name (re-exports via `__init__.py` etc.),
 * - a package-scoped binding (Java/Go) → pending import to the declaring file.
 */
import type { SgNode } from '@ast-grep/napi';
import type { ImportBinding, PendingRelation } from '../../contracts/symbols.js';
import { generateEntityId, generateRelationId } from '../../utils/id.js';
import type { RelationEmitter } from './emitter.js';
import path from 'node:path';

export function fileId(filePath: string): string {
  return generateEntityId(filePath, path.basename(filePath), 'file');
}

export function emitImportEdges(em: RelationEmitter, bindings: ImportBinding[], node: SgNode): void {
  const from = fileId(em.filePath);
  const r = node.range();
  const line = r.start.line + 1;
  const column = r.start.column + 1;
  const seen = new Set<string>();
  for (const b of bindings) {
    if (b.external) continue;
    if (b.source_file) {
      if (b.source_file !== em.filePath && !seen.has(b.source_file)) {
        seen.add(b.source_file);
        const to = fileId(b.source_file);
        em.relations.push({
          id: generateRelationId(from, to, 'import', em.filePath, line),
          from, to, type: 'import',
          location: { file: em.filePath, line, column },
          weight: 1, confidence: 1,
        });
      }
      if (b.imported !== '*' && b.local) {
        em.pending(from, 'import', b.local, node, { resolve_to: 'file', optional: true, meta: { via: b.source_file } });
      }
      continue;
    }
    if (b.source_package !== undefined) {
      if (b.local && b.local !== '*') em.pending(from, 'import', b.local, node, { resolve_to: 'file' });
      continue;
    }
    if (seen.has(`?${b.specifier}`)) continue;
    seen.add(`?${b.specifier}`);
    const rel: PendingRelation = {
      id: generateRelationId(from, `?${b.specifier}`, 'import', em.filePath, line),
      from, to: '', type: 'import',
      location: { file: em.filePath, line, column },
      weight: 1, confidence: 1,
      resolution: 'unresolved', target_name: b.specifier, final: true,
    };
    em.relations.push(rel);
  }
}
