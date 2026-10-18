/**
 * Builds the type environment (type-scope.ts) while the relation walk runs:
 * the module scope up front (so a helper above `const store = new Store()`
 * still sees it), function scopes from their parameters, and local
 * declarations as they are met in document order.
 */
import type { SgNode } from '@ast-grep/napi';
import { findChild } from '../extractor-helpers.js';
import type { FileTypeIndex } from './type-members.js';
import { signatureMembers, type MemberTypes } from './type-members.js';
import { annotationTypeName, declaratorTypeName } from './type-names.js';
import { TypeScope } from './type-scope.js';

/** Every name a binding pattern (`a`, `{ a, b: c }`, `[x, ...rest]`) introduces. */
export function boundNames(pattern: SgNode): string[] {
  const out: string[] = [];
  const stack: SgNode[] = [pattern];
  while (stack.length > 0) {
    const n = stack.pop()!;
    switch (String(n.kind())) {
      case 'identifier':
      case 'shorthand_property_identifier_pattern':
        out.push(n.text());
        break;
      case 'pair_pattern': {
        const kids = n.children();
        stack.push(kids[kids.length - 1]);
        break;
      }
      case 'object_assignment_pattern':
      case 'assignment_pattern':
        stack.push(n.children()[0]);
        break;
      case 'object_pattern':
      case 'array_pattern':
      case 'rest_pattern':
        for (const c of n.children()) stack.push(c);
        break;
    }
  }
  return out;
}

/** Declare one `variable_declarator`: a typed name, or unknown names for destructuring. */
export function declareDeclarator(declarator: SgNode, scope: TypeScope): void {
  const target = declarator.children()[0];
  if (!target) return;
  if (target.kind() === 'identifier') scope.declare(target.text(), declaratorTypeName(declarator));
  else for (const name of boundNames(target)) scope.declare(name, null);
}

/** Top-level `const/let/var` declarations of the module, before the walk starts. */
export function buildModuleScope(root: SgNode): { scope: TypeScope; declared: Set<number> } {
  const scope = new TypeScope(null);
  const declared = new Set<number>();
  for (const stmt of root.children()) {
    const decl = stmt.kind() === 'export_statement'
      ? stmt.children().find((c) => c.kind() === 'lexical_declaration' || c.kind() === 'variable_declaration')
      : stmt;
    if (!decl || (decl.kind() !== 'lexical_declaration' && decl.kind() !== 'variable_declaration')) continue;
    for (const d of decl.children()) {
      if (d.kind() !== 'variable_declarator') continue;
      declared.add(d.range().start.index);
      declareDeclarator(d, scope);
    }
  }
  return { scope, declared };
}

/** Scope of a function-like node: its parameters (typed where annotated). */
export function buildFunctionScope(fn: SgNode, parent: TypeScope, types: FileTypeIndex): TypeScope {
  const scope = parent.child();
  const params = findChild(fn, 'formal_parameters');
  if (!params) {
    // `x => …` — a single bare identifier parameter
    const bare = fn.kind() === 'arrow_function' ? fn.children()[0] : undefined;
    if (bare?.kind() === 'identifier') scope.declare(bare.text(), null);
    return scope;
  }
  for (const p of params.children()) {
    const k = p.kind();
    if (k !== 'required_parameter' && k !== 'optional_parameter') continue;
    const pattern = p.children().find((c) => c.kind() !== 'accessibility_modifier' && c.kind() !== 'readonly' && c.kind() !== 'override');
    if (!pattern) continue;
    const annotation = findChild(p, 'type_annotation');
    if (pattern.kind() === 'identifier') {
      scope.declare(pattern.text(), annotationTypeName(annotation));
    } else if (pattern.kind() === 'object_pattern') {
      declareObjectPattern(pattern, annotation, scope, types);
    } else {
      for (const name of boundNames(pattern)) scope.declare(name, null);
    }
  }
  return scope;
}

/** `{ a, b: c, d = x }: Opts` — property types come from a same-file interface / alias / inline type. */
function declareObjectPattern(pattern: SgNode, annotation: SgNode | null, scope: TypeScope, types: FileTypeIndex): void {
  const props = propsOfAnnotation(annotation, types);
  for (const m of pattern.children()) {
    const k = m.kind();
    if (k === 'shorthand_property_identifier_pattern') {
      scope.declare(m.text(), props?.get(m.text()) ?? null);
    } else if (k === 'object_assignment_pattern') {
      const name = m.children()[0]?.text();
      if (name) scope.declare(name, props?.get(name) ?? null);
    } else if (k === 'pair_pattern') {
      const kids = m.children();
      const key = kids[0]?.text();
      const value = kids[kids.length - 1];
      if (value?.kind() === 'identifier') scope.declare(value.text(), (key && props?.get(key)) || null);
      else if (value) for (const name of boundNames(value)) scope.declare(name, null);
    } else if (k === 'rest_pattern') {
      for (const name of boundNames(m)) scope.declare(name, null);
    }
  }
}

function propsOfAnnotation(annotation: SgNode | null, types: FileTypeIndex): MemberTypes | undefined {
  if (!annotation) return undefined;
  const inline = findChild(annotation, 'object_type');
  if (inline) return signatureMembers(inline);
  const name = annotationTypeName(annotation);
  return name ? types.propertyTypes(name) : undefined;
}
