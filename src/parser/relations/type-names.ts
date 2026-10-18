/**
 * Declared types of locals, parameters and fields (TS/JS), as *names written
 * in the file*. Only syntactic facts are used — an annotation, a `new X()`
 * initializer of a `const`, an `as X` assertion — never inference, so a name
 * that is returned is what the author declared.
 */
import type { SgNode } from '@ast-grep/napi';
import { findChild } from '../extractor-helpers.js';

const NULLISH = new Set(['null', 'undefined']);

/** `: Foo`, `: Foo | null`, `: ns.Foo<T>` → `Foo` / `ns.Foo`; null for primitives, arrays, functions, unions of classes. */
export function annotationTypeName(annotation: SgNode | null | undefined): string | null {
  if (!annotation) return null;
  const inner = annotation.kind() === 'type_annotation'
    ? annotation.children().find((c) => c.kind() !== ':')
    : annotation;
  return inner ? typeNodeName(inner) : null;
}

export function typeNodeName(t: SgNode): string | null {
  switch (String(t.kind())) {
    case 'type_identifier':
      return t.text();
    case 'nested_type_identifier': {
      const text = t.text();
      return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(text) ? text : null;
    }
    case 'generic_type': {
      const head = t.children()[0];
      return head ? typeNodeName(head) : null;
    }
    case 'parenthesized_type': {
      const inner = t.children().find((c) => c.kind() !== '(' && c.kind() !== ')');
      return inner ? typeNodeName(inner) : null;
    }
    case 'union_type': {
      const members = unionMembers(t).filter((m) => !isNullish(m));
      return members.length === 1 ? typeNodeName(members[0]) : null;
    }
    default:
      return null;
  }
}

function unionMembers(t: SgNode): SgNode[] {
  const out: SgNode[] = [];
  for (const c of t.children()) {
    if (c.kind() === 'union_type') out.push(...unionMembers(c));
    else if (c.kind() !== '|') out.push(c);
  }
  return out;
}

function isNullish(t: SgNode): boolean {
  const k = t.kind();
  return (k === 'literal_type' || k === 'predefined_type') && NULLISH.has(t.text());
}

/** `new Foo()` → `Foo`; `new ns.Foo()` → `ns.Foo`; `(x as Foo)` / `<Foo>x` / `x satisfies Foo` → `Foo`; else null. */
export function expressionTypeName(expr: SgNode | null | undefined): string | null {
  if (!expr) return null;
  switch (String(expr.kind())) {
    case 'new_expression': {
      const ctor = expr.children().find((c) => c.kind() !== 'new');
      if (!ctor) return null;
      const k = ctor.kind();
      if (k === 'identifier') return ctor.text();
      if (k === 'member_expression') return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(ctor.text()) ? ctor.text() : null;
      return null;
    }
    case 'as_expression':
    case 'satisfies_expression': {
      const t = expr.children().find((c, i) => i > 0 && c.kind() !== 'as' && c.kind() !== 'satisfies');
      return t ? typeNodeName(t) : null;
    }
    case 'type_assertion': {
      const args = findChild(expr, 'type_arguments');
      const t = args?.children().find((c) => c.kind() !== '<' && c.kind() !== '>');
      return t ? typeNodeName(t) : null;
    }
    case 'parenthesized_expression':
    case 'non_null_expression':
      return expressionTypeName(expr.children().find((c) => !['(', ')', '!'].includes(String(c.kind()))));
    default:
      return null;
  }
}

/** Is this lexical declaration a `const`? */
export function isConstDeclaration(declaration: SgNode | null): boolean {
  return !!declaration && declaration.kind() === 'lexical_declaration'
    && declaration.children().some((c) => c.kind() === 'const');
}

/**
 * Declared type of a `variable_declarator`: the annotation, else (for `const`
 * only — `let`/`var` can be reassigned) the constructor or assertion type of
 * its initializer.
 */
export function declaratorTypeName(declarator: SgNode): string | null {
  const fromAnnotation = annotationTypeName(findChild(declarator, 'type_annotation'));
  if (fromAnnotation) return fromAnnotation;
  if (!isConstDeclaration(declarator.parent())) return null;
  const kids = declarator.children();
  const eq = kids.findIndex((c) => c.kind() === '=');
  return eq >= 0 ? expressionTypeName(kids[eq + 1]) : null;
}
