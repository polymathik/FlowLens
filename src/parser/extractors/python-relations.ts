/**
 * Python relation extraction — one iterative walk with a scope frame.
 *
 * import    file → module file (+ declaring file for names re-exported via `__init__`)
 * extend    class → each base (`Base`, `mod.Base`)
 * override  method → `Base.<method>` (optional: dropped when the base lacks it)
 * call      `f()`, `mod.f()`, `self.m()` (own class, else bases), `super().m()`;
 *           a call whose target is a class is a `create`
 * decorate  decorator entity → decorated definition
 * contain   class → methods / fields
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { walkWithContext } from '../ast-walk.js';
import { RelationEmitter, loc } from '../symbols/emitter.js';
import { emitImportEdges } from '../symbols/import-edges.js';
import { containRelations } from '../relations/data-relations.js';
import { aggregateRelations } from '../../graph/aggregate.js';
import { decoratorName } from './python-ast.js';

const CALL_KINDS: EntityKind[] = ['function', 'method', 'class', 'variable'];

interface Frame {
  path: string[];
  entity: Entity | undefined;
  cls: { entity: Entity; bases: string[] } | null;
}

export function extractPythonRelations(
  root: SgNode, fp: string, entities: Entity[], symbols: FileSymbols,
): Relation[] {
  const em = new RelationEmitter(fp, entities, symbols);
  const decoratorsAt = new Map<string, Entity>();
  for (const e of entities) if (e.kind === 'decorator') decoratorsAt.set(`${e.location.line_start}:${e.location.column_start}`, e);
  const methods = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.kind !== 'method') continue;
    const owner = e.qualified_name.slice(0, e.qualified_name.lastIndexOf('.'));
    methods.set(owner, [...(methods.get(owner) ?? []), e]);
  }

  walkWithContext<Frame>(root, { path: [], entity: undefined, cls: null }, (node, frame) => {
    switch (node.kind()) {
      case 'import_statement':
      case 'import_from_statement': {
        const line = loc(node).line;
        emitImportEdges(em, symbols.imports.filter((b) => b.location.line === line), node);
        return null;
      }
      case 'class_definition': {
        const name = findChildText(node, 'identifier');
        if (!name) return frame;
        const path = [...frame.path, name];
        const cls = em.entityAt(path, ['class']);
        if (!cls) return { ...frame, path };
        const bases = classBases(node);
        for (const { text, node: b } of bases) em.link(cls, 'extend', text, b);
        for (const m of methods.get(cls.qualified_name) ?? []) {
          for (const { text } of bases) em.link(m, 'override', `${text}.${m.name}`, node, { optional: true });
        }
        return { path, entity: cls, cls: { entity: cls, bases: bases.map((b) => b.text) } };
      }
      case 'function_definition': {
        const name = findChildText(node, 'identifier');
        if (!name) return frame;
        const path = [...frame.path, name];
        return { path, entity: em.entityAt(path, ['method', 'function']) ?? frame.entity, cls: frame.cls };
      }
      case 'decorated_definition':
        handleDecorators(node, frame, em, decoratorsAt);
        return frame;
      case 'call':
        handleCall(node, frame, em);
        return frame;
      default:
        return frame;
    }
  });

  return aggregateRelations([...containRelations(entities, fp), ...em.relations]);
}

function classBases(node: SgNode): Array<{ text: string; node: SgNode }> {
  const args = findChild(node, 'argument_list');
  if (!args) return [];
  return args.children()
    .filter((c) => c.kind() === 'identifier' || c.kind() === 'attribute')
    .map((c) => ({ text: c.text(), node: c }));
}

function handleDecorators(node: SgNode, frame: Frame, em: RelationEmitter, decoratorsAt: Map<string, Entity>): void {
  const def = node.children().find((c) => c.kind() === 'function_definition' || c.kind() === 'class_definition');
  const name = def ? findChildText(def, 'identifier') : null;
  if (!name) return;
  const target = em.entityAt([...frame.path, name]);
  if (!target) return;
  for (const dec of node.children()) {
    if (dec.kind() !== 'decorator' || !decoratorName(dec)) continue;
    const { line, column } = loc(dec);
    const entity = decoratorsAt.get(`${line}:${column}`);
    if (entity) em.direct(entity, target, 'decorate', dec);
  }
}

function handleCall(node: SgNode, frame: Frame, em: RelationEmitter): void {
  const from = frame.entity;
  if (!from) return;
  const fn = node.children()[0];
  if (!fn) return;
  if (fn.kind() === 'identifier') {
    em.link(from, 'call', fn.text(), node, { kinds: CALL_KINDS });
    return;
  }
  if (fn.kind() !== 'attribute') return;
  const parts = fn.children().filter((c) => c.kind() !== '.');
  const object = parts[0];
  const attr = parts[parts.length - 1]?.text();
  if (!object || !attr) return;

  const isSelf = object.kind() === 'identifier' && (object.text() === 'self' || object.text() === 'cls');
  const isSuper = object.kind() === 'call' && object.children()[0]?.text() === 'super';
  if (isSelf || isSuper) {
    if (!frame.cls) return;
    if (isSelf) {
      const own = em.member(frame.cls.entity, attr, ['method']);
      if (own) { em.direct(from, own, 'call', node); return; }
    }
    for (const base of frame.cls.bases) {
      if (em.link(from, 'call', `${base}.${attr}`, node, { optional: true, kinds: CALL_KINDS }) !== 'dropped') return;
    }
    return;
  }
  const receiver = fn.text();
  if (!/^[A-Za-z_][\w.]*$/.test(receiver)) return;
  const head = receiver.split('.')[0];
  const binding = em.binding(head) ?? em.binding(receiver.slice(0, receiver.lastIndexOf('.')));
  em.link(from, 'call', receiver, node, { kinds: CALL_KINDS, optional: !binding || binding.imported !== '*' });
}
