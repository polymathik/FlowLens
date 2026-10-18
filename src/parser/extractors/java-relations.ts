/**
 * Java relation extraction — one iterative walk with a scope frame.
 *
 * Unqualified names resolve in this order: same file → import bindings →
 * same package (pass 2) → external (java.lang etc., dropped).
 * Local variable / parameter declared types are tracked per method so
 * `Dog d = …; d.speak()` links to `Dog.speak`.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { FileSymbols } from '../../contracts/symbols.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { walkWithContext } from '../ast-walk.js';
import { RelationEmitter, loc } from '../symbols/emitter.js';
import { emitImportEdges } from '../symbols/import-edges.js';
import { containRelations } from '../relations/data-relations.js';
import { aggregateRelations } from '../../graph/aggregate.js';
import { annotationsOf } from './java-extractor.js';

interface Frame {
  path: string[];
  entity: Entity | undefined;
  cls: { entity: Entity; bases: string[] } | null;
  locals: Map<string, string> | null;
  inThrow: boolean;
}

const CLASS_LIKE = new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']);

/** Dotted type name of a type node (`Dog`, `List<Dog>` → `List`, `a.b.C`). */
export function javaTypeName(node: SgNode | undefined | null): string | null {
  if (!node) return null;
  const k = node.kind();
  if (k === 'type_identifier' || k === 'identifier' || k === 'scoped_type_identifier') return node.text();
  if (k === 'generic_type') return javaTypeName(node.children()[0]);
  return null;
}

export function extractJavaRelations(root: SgNode, fp: string, entities: Entity[], symbols: FileSymbols): Relation[] {
  const em = new RelationEmitter(fp, entities, symbols, { packageScope: true });
  const methodsOf = (cls: Entity) => entities.filter((e) => e.kind === 'method'
    && e.qualified_name.startsWith(cls.qualified_name + '.') && !e.qualified_name.slice(cls.qualified_name.length + 1).includes('.'));
  const annotationAt = new Map<string, Entity>();
  for (const e of entities) if (e.kind === 'decorator') annotationAt.set(`${e.location.line_start}:${e.location.column_start}`, e);

  const decorate = (node: SgNode, target: Entity | undefined) => {
    if (!target) return;
    for (const a of annotationsOf(node)) {
      const { line, column } = loc(a);
      const dec = annotationAt.get(`${line}:${column}`);
      if (dec) em.direct(dec, target, 'decorate', a);
    }
  };

  walkWithContext<Frame>(root, { path: [], entity: undefined, cls: null, locals: null, inThrow: false }, (node, frame) => {
    const k = String(node.kind());
    if (k === 'import_declaration') {
      const line = loc(node).line;
      emitImportEdges(em, symbols.imports.filter((b) => b.location.line === line), node);
      return null;
    }
    if (CLASS_LIKE.has(k)) {
      const name = findChildText(node, 'identifier');
      if (!name) return frame;
      const path = [...frame.path, name];
      const cls = em.entityAt(path, ['class', 'interface', 'enum']);
      if (!cls) return { ...frame, path };
      decorate(node, cls);
      const bases = heritage(node, cls, em);
      for (const m of methodsOf(cls)) {
        for (const b of bases) em.link(m, 'override', `${b}.${m.name}`, node, { optional: true });
      }
      return { path, entity: cls, cls: { entity: cls, bases }, locals: null, inThrow: false };
    }
    if (k === 'method_declaration' || k === 'constructor_declaration') {
      const name = findChildText(node, 'identifier');
      if (!name) return frame;
      const path = [...frame.path, name];
      const m = em.entityAt(path, ['method']);
      const locals = new Map<string, string>();
      if (m) {
        decorate(node, m);
        signatureRelations(node, m, em, locals);
      }
      return { ...frame, path, entity: m ?? frame.entity, locals, inThrow: false };
    }
    if (k === 'field_declaration') {
      for (const vd of node.children()) {
        const fname = vd.kind() === 'variable_declarator' ? findChildText(vd, 'identifier') : null;
        if (fname && frame.cls) decorate(node, em.member(frame.cls.entity, fname, ['field']));
      }
      return frame;
    }
    if (k === 'local_variable_declaration' && frame.locals) {
      const type = javaTypeName(node.children().find((c) => c.kind() !== 'modifiers'));
      for (const vd of node.children()) {
        const v = vd.kind() === 'variable_declarator' ? findChildText(vd, 'identifier') : null;
        if (v && type) frame.locals.set(v, type);
      }
      return frame;
    }
    if (k === 'identifier' && frame.entity && frame.cls && frame.locals && !frame.locals.has(node.text())) {
      // read of an own field (unqualified or `this.x`)
      const field = em.member(frame.cls.entity, node.text(), ['field']);
      if (field) em.direct(frame.entity, field, 'use', node);
      return null;
    }
    if (k === 'throw_statement') return { ...frame, inThrow: true };
    if (k === 'object_creation_expression' && frame.entity) {
      const type = javaTypeName(node.children().find((c) => c.kind() !== 'new'));
      if (type) em.link(frame.entity, frame.inThrow ? 'throw' : 'create', type, node);
      return frame;
    }
    if (k === 'method_invocation' && frame.entity) {
      handleInvocation(node, frame, em);
      return frame;
    }
    return frame;
  });

  return aggregateRelations([...containRelations(entities, fp), ...em.relations]);
}

/** extend / implement edges; returns base type names (superclass first). */
function heritage(node: SgNode, cls: Entity, em: RelationEmitter): string[] {
  const bases: string[] = [];
  const sc = findChild(node, 'superclass');
  const superName = sc ? javaTypeName(sc.children().find((c) => c.kind() !== 'extends')) : null;
  if (superName && sc) { em.link(cls, 'extend', superName, sc); bases.push(superName); }
  const lists: Array<[SgNode | null, 'implement' | 'extend']> = [
    [findChild(node, 'super_interfaces'), 'implement'],
    [findChild(node, 'extends_interfaces'), 'extend'],
  ];
  for (const [clause, type] of lists) {
    const tl = clause ? findChild(clause, 'type_list') : null;
    for (const t of tl?.children() ?? []) {
      const name = javaTypeName(t);
      if (name) { em.link(cls, type, name, t); bases.push(name); }
    }
  }
  return bases;
}

function signatureRelations(node: SgNode, m: Entity, em: RelationEmitter, locals: Map<string, string>): void {
  let sawName = false;
  for (const c of node.children()) {
    const k = c.kind();
    if (k === 'identifier') { sawName = true; continue; }
    if (!sawName) {
      const ret = javaTypeName(c);
      if (ret && k !== 'modifiers') em.link(m, 'return', ret, c);
      continue;
    }
    if (k === 'formal_parameters') {
      for (const p of c.children()) {
        if (p.kind() !== 'formal_parameter' && p.kind() !== 'spread_parameter') continue;
        const type = javaTypeName(p.children().find((x) => x.kind() !== 'modifiers'));
        const pname = findChildText(p, 'identifier');
        if (!type) continue;
        em.link(m, 'parameter', type, p);
        if (pname) locals.set(pname, type);
      }
    } else if (k === 'throws') {
      for (const t of c.children()) {
        const type = javaTypeName(t);
        if (type) em.link(m, 'throw', type, t);
      }
    }
  }
}

function handleInvocation(node: SgNode, frame: Frame, em: RelationEmitter): void {
  const from = frame.entity!;
  const parts = node.children().filter((c) => c.kind() !== '.' && c.kind() !== 'argument_list' && c.kind() !== 'type_arguments');
  const nameNode = parts[parts.length - 1];
  if (!nameNode || nameNode.kind() !== 'identifier') return;
  const name = nameNode.text();
  const object = parts.length > 1 ? parts[0] : null;

  const viaBases = () => {
    for (const b of frame.cls?.bases ?? []) {
      if (em.link(from, 'call', `${b}.${name}`, node, { optional: true }) !== 'dropped') return;
    }
  };
  if (!object || object.kind() === 'this') {
    const own = frame.cls ? em.member(frame.cls.entity, name, ['method']) : undefined;
    if (own) em.direct(from, own, 'call', node);
    else viaBases();
    return;
  }
  if (object.kind() === 'super') { viaBases(); return; }
  if (object.kind() !== 'identifier' && object.kind() !== 'field_access') return;
  const receiver = object.text();
  const localType = frame.locals?.get(receiver);
  if (localType) {
    em.link(from, 'call', `${localType}.${name}`, node, { optional: true });
  } else if (/^[A-Z]/.test(receiver)) {
    em.link(from, 'call', `${receiver}.${name}`, node, { optional: true });
  }
}
