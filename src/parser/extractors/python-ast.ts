/**
 * Small Python AST helpers shared by the entity extractor and
 * python-relations.ts (kept separate so the two modules do not import each other).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Visibility } from '../../contracts/entities.js';

export function pythonVisibility(name: string): Visibility {
  if (name.startsWith('__') && !name.endsWith('__')) return 'private';
  return name.startsWith('_') ? 'protected' : 'public';
}

/** `@name`, `@name(...)`, `@a.b`, `@a.b(...)` → dotted name. */
export function decoratorName(dec: SgNode): string | null {
  for (const child of dec.children()) {
    const k = child.kind();
    if (k === 'identifier' || k === 'attribute') return child.text();
    if (k === 'call') {
      const fn = child.children()[0];
      if (fn && (fn.kind() === 'identifier' || fn.kind() === 'attribute')) return fn.text();
    }
  }
  return null;
}
