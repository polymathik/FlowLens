/**
 * Source text of the `extends` target of a class / interface, recorded as
 * `annotations.extends` so that pass 2 knows a base exists even when it is
 * external or unresolvable (a member missing from such a type may be inherited
 * from outside the project and must not be reported as unresolved).
 */
import type { SgNode } from '@ast-grep/napi';
import { findChild } from './extractor-helpers.js';

/** Source text of the `extends` target (`Base`, `ns.Base`, `Mixin(Base)`), if any. */
export function baseClassText(node: SgNode): string | null {
  const heritage = findChild(node, 'class_heritage');
  if (!heritage) return null;
  const clause = findChild(heritage, 'extends_clause') ?? heritage;
  const kids = clause.children();
  const at = kids.findIndex((c) => c.kind() === 'extends');
  const base = at >= 0 ? kids[at + 1] : undefined;
  if (!base || base.kind() === 'type_arguments') return null;
  const text = base.text().replace(/\s+/g, ' ');
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

/** Source text of the `extends A, B<T>` list of an interface, if any. */
export function interfaceBaseText(node: SgNode): string | null {
  const clause = findChild(node, 'extends_type_clause');
  if (!clause) return null;
  const text = clause.children().filter((c) => c.kind() !== 'extends').map((c) => c.text()).join('').replace(/\s+/g, ' ');
  return text.length > 80 ? `${text.slice(0, 77)}...` : text || null;
}
