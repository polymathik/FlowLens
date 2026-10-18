/**
 * Java language extractor.
 *
 * Entities: classes, interfaces, enums (+ constants), methods, constructors,
 * fields, annotations (as decorators scoped under the annotated member:
 * `Dog.speak.@Override`). Overloaded methods share one qualified name; the
 * parser keeps the first and counts the rest as duplicate declarations.
 * Relations live in java-relations.ts, imports/package in java-symbols.ts.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import { javaVisibility, annotationsOf, annotationName } from './java-ast.js';
import { extractJavaSymbols } from './java-symbols.js';
import { extractJavaRelations } from './java-relations.js';

const LANG = 'java';

const TYPE_DECLS: Record<string, { kind: EntityKind; body: string }> = {
  class_declaration: { kind: 'class', body: 'class_body' },
  interface_declaration: { kind: 'interface', body: 'interface_body' },
  enum_declaration: { kind: 'enum', body: 'enum_body' },
  record_declaration: { kind: 'class', body: 'class_body' },
  annotation_type_declaration: { kind: 'interface', body: 'annotation_type_body' },
};

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];
  const stack: Array<[SgNode, string[]]> = [[root, []]];
  while (stack.length > 0) {
    const [container, parents] = stack.pop()!;
    for (const node of container.children()) {
      const k = String(node.kind());
      const decl = TYPE_DECLS[k];
      if (decl) {
        const name = findChildText(node, 'identifier');
        if (!name) continue;
        out.push(makeEntity(node, name, decl.kind, javaVisibility(node), fp, LANG, parents));
        addAnnotations(node, [...parents, name], out, fp);
        const body = findChild(node, decl.body);
        if (body) stack.push([body, [...parents, name]]);
        if (k === 'enum_declaration' && body) addEnumConstants(body, [...parents, name], out, fp);
      } else if (k === 'method_declaration' || k === 'constructor_declaration') {
        const name = findChildText(node, 'identifier');
        if (!name) continue;
        out.push(makeEntity(node, name, 'method', javaVisibility(node), fp, LANG, parents));
        addAnnotations(node, [...parents, name], out, fp);
      } else if (k === 'field_declaration' || k === 'constant_declaration') {
        for (const c of node.children()) {
          if (c.kind() !== 'variable_declarator') continue;
          const name = findChildText(c, 'identifier');
          if (!name) continue;
          out.push(makeEntity(node, name, 'field', javaVisibility(node), fp, LANG, parents));
          addAnnotations(node, [...parents, name], out, fp);
        }
      } else if (k === 'enum_body_declarations') {
        stack.push([node, parents]);
      }
    }
  }
  return out.sort((a, b) => a.location.line_start - b.location.line_start || a.location.column_start - b.location.column_start);
}

function addEnumConstants(body: SgNode, parents: string[], out: Entity[], fp: string): void {
  for (const c of body.children()) {
    if (c.kind() !== 'enum_constant') continue;
    const name = findChildText(c, 'identifier');
    if (name) out.push(makeEntity(c, name, 'enum_member', 'public', fp, LANG, parents));
  }
}

function addAnnotations(node: SgNode, scope: string[], out: Entity[], fp: string): void {
  for (const a of annotationsOf(node)) {
    const name = annotationName(a);
    if (!name) continue;
    const e = makeEntity(a, `@${name}`, 'decorator', 'public', fp, LANG, scope);
    e.name = name;
    out.push(e);
  }
}

export const javaExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.java'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'implement', 'override', 'use', 'contain',
    'create', 'parameter', 'return', 'throw', 'decorate',
  ] as RelationType[],
  cognitiveComplexity: true,
  extractEntities,
  extractSymbols(root, filePath) {
    return extractJavaSymbols(root, filePath);
  },
  extractRelations(root, filePath, entities, _rootDir, symbols) {
    return extractJavaRelations(root, filePath, entities, symbols ?? extractJavaSymbols(root, filePath));
  },
};
