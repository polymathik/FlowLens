/**
 * Declared property types of the classes, interfaces and object type aliases
 * of one file: `class A { private store: Store }`, `constructor(private dep: Dep)`,
 * `interface Opts { discovery: DiscoveryService }`, `type T = { a: Foo }`.
 *
 * Built lazily (only files with a member call on a typed receiver pay for it)
 * from the top-level statements; same-file declarations only. Method signatures
 * and static members are not properties and are skipped.
 */
import type { SgNode } from '@ast-grep/napi';
import { findChild } from '../extractor-helpers.js';
import { annotationTypeName, expressionTypeName } from './type-names.js';

/** property name → declared type name */
export type MemberTypes = Map<string, string>;

const CLASS_DECLARATIONS = new Set(['class_declaration', 'abstract_class_declaration']);

export class FileTypeIndex {
  private index: Map<string, MemberTypes> | null = null;

  constructor(private readonly root: SgNode) {}

  /** Property types of the same-file class / interface / object type alias `typeName`. */
  propertyTypes(typeName: string): MemberTypes | undefined {
    this.index ??= this.build();
    return this.index.get(typeName);
  }

  private build(): Map<string, MemberTypes> {
    const out = new Map<string, MemberTypes>();
    for (const stmt of this.root.children()) {
      const node = stmt.kind() === 'export_statement'
        ? stmt.children().find((c) => CLASS_DECLARATIONS.has(String(c.kind())) || c.kind() === 'interface_declaration' || c.kind() === 'type_alias_declaration') ?? stmt
        : stmt;
      const kind = String(node.kind());
      const name = findChild(node, 'type_identifier')?.text();
      if (!name) continue;
      if (CLASS_DECLARATIONS.has(kind)) out.set(name, classMembers(node));
      else if (kind === 'interface_declaration') {
        const body = findChild(node, 'interface_body') ?? findChild(node, 'object_type');
        if (body) out.set(name, signatureMembers(body));
      } else if (kind === 'type_alias_declaration') {
        const body = findChild(node, 'object_type');
        if (body) out.set(name, signatureMembers(body));
      }
    }
    return out;
  }
}

/** Property types of an inline object type (`{ a: Foo; b: Bar }`). */
export function signatureMembers(body: SgNode): MemberTypes {
  const out: MemberTypes = new Map();
  for (const m of body.children()) {
    if (m.kind() !== 'property_signature') continue;
    const name = findChild(m, 'property_identifier')?.text();
    const type = annotationTypeName(findChild(m, 'type_annotation'));
    if (name && type) out.set(name, type);
  }
  return out;
}

function classMembers(cls: SgNode): MemberTypes {
  const out: MemberTypes = new Map();
  const body = findChild(cls, 'class_body');
  if (!body) return out;
  for (const m of body.children()) {
    if (m.kind() === 'public_field_definition') {
      if (m.children().some((c) => c.kind() === 'static')) continue;
      const name = (findChild(m, 'property_identifier') ?? findChild(m, 'private_property_identifier'))?.text();
      if (!name) continue;
      const kids = m.children();
      const eq = kids.findIndex((c) => c.kind() === '=');
      const type = annotationTypeName(findChild(m, 'type_annotation')) ?? (eq >= 0 ? expressionTypeName(kids[eq + 1]) : null);
      if (type) out.set(name, type);
    } else if (m.kind() === 'method_definition' && findChild(m, 'property_identifier')?.text() === 'constructor') {
      for (const p of findChild(m, 'formal_parameters')?.children() ?? []) {
        if (p.kind() !== 'required_parameter' && p.kind() !== 'optional_parameter') continue;
        const isProperty = p.children().some((c) => c.kind() === 'accessibility_modifier' || c.kind() === 'readonly');
        const name = findChild(p, 'identifier')?.text();
        const type = annotationTypeName(findChild(p, 'type_annotation'));
        if (isProperty && name && type) out.set(name, type);
      }
    }
  }
  return out;
}


