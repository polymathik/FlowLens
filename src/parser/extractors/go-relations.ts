/**
 * Go relation extraction — one iterative walk.
 *
 * call    `f()` (same file, else same package in pass 2), `pkg.F()` through an
 *         import binding; method calls on values (`x.M()`) need types and are
 *         dropped
 * create  composite literals `T{}` / `pkg.T{}`
 * import  file → declaring file of every `pkg.X` actually referenced
 * contain struct → fields, struct → methods declared in the same file
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { walkWithContext } from '../ast-walk.js';
import { RelationEmitter } from '../symbols/emitter.js';
import { fileId } from '../symbols/import-edges.js';
import { containRelations } from '../relations/data-relations.js';
import { aggregateRelations } from '../../graph/aggregate.js';

/** Receiver type name of a method_declaration (`(r Rect)` / `(r *Rect)`). */
export function receiverType(node: SgNode): string | null {
  const params = node.children().find((c) => c.kind() === 'parameter_list');
  const pd = params ? findChild(params, 'parameter_declaration') : null;
  if (!pd) return null;
  const direct = findChildText(pd, 'type_identifier');
  if (direct) return direct;
  const ptr = findChild(pd, 'pointer_type');
  if (ptr) return findChildText(ptr, 'type_identifier');
  const generic = findChild(pd, 'generic_type');
  return generic ? findChildText(generic, 'type_identifier') : null;
}

export function extractGoRelations(root: SgNode, fp: string, entities: Entity[], symbols: FileSymbols): Relation[] {
  const em = new RelationEmitter(fp, entities, symbols, { packageScope: true });
  const fromFile = fileId(fp);

  const reference = (from: Entity, type: 'call' | 'create', name: string, node: SgNode) => {
    em.link(from, type, name, node);
    const head = name.split('.')[0];
    if (name.includes('.') && em.isImported(head)) {
      em.pending(fromFile, 'import', name, node, { resolve_to: 'file', optional: true });
    }
  };

  walkWithContext<Entity | undefined>(root, undefined, (node, cur) => {
    const k = node.kind();
    if (k === 'import_declaration') return null;
    if (k === 'function_declaration') {
      const name = findChildText(node, 'identifier');
      return (name ? em.entityAt([name], ['function']) : undefined) ?? cur;
    }
    if (k === 'method_declaration') {
      const name = findChildText(node, 'field_identifier');
      const recv = receiverType(node);
      return (name ? em.entityAt(recv ? [recv, name] : [name], ['method']) : undefined) ?? cur;
    }
    if (!cur) return cur;
    if (k === 'call_expression') {
      const fn = node.children()[0];
      if (fn?.kind() === 'identifier') reference(cur, 'call', fn.text(), node);
      else if (fn?.kind() === 'selector_expression') {
        const obj = fn.children()[0];
        if (obj?.kind() === 'identifier' && em.isImported(obj.text())) reference(cur, 'call', fn.text(), node);
      }
      return cur;
    }
    if (k === 'composite_literal') {
      const type = node.children()[0];
      if (type?.kind() === 'type_identifier') reference(cur, 'create', type.text(), node);
      else if (type?.kind() === 'qualified_type') reference(cur, 'create', type.text(), node);
      return cur;
    }
    return cur;
  });

  return aggregateRelations([...containRelations(entities, fp), ...em.relations]);
}
