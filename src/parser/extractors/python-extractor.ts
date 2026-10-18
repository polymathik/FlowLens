/**
 * Python language extractor.
 *
 * Entities: classes, functions, methods, class fields, module variables,
 * decorators (scoped under the decorated definition: `Cls.method.@dec`).
 * Only module-level and class-level statements are visited — function
 * bodies hold locals, not entities. Relations live in python-relations.ts,
 * imports in python-symbols.ts.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import { extractPythonSymbols } from './python-symbols.js';
import { extractPythonRelations } from './python-relations.js';

const LANG = 'python';

/** Statement kinds whose children may hold further module/class-level declarations. */
const CONTAINERS = new Set([
  'module', 'block', 'if_statement', 'elif_clause', 'else_clause', 'try_statement',
  'except_clause', 'finally_clause', 'with_statement', 'for_statement', 'while_statement',
]);

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

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];
  // Explicit stack: [node, parents, inClass]
  const stack: Array<[SgNode, string[], boolean]> = [[root, [], false]];
  while (stack.length > 0) {
    const [node, parents, inClass] = stack.pop()!;
    const children = node.children();
    for (let i = children.length - 1; i >= 0; i--) {
      const c = children[i];
      const k = String(c.kind());
      if (k === 'class_definition' || k === 'function_definition' || k === 'decorated_definition') {
        visitDefinition(c, parents, inClass, out, stack, fp);
      } else if (k === 'expression_statement') {
        visitAssignment(c, parents, inClass, out, fp);
      } else if (CONTAINERS.has(k)) {
        stack.push([c, parents, inClass]);
      }
    }
  }
  // Stack order visits later siblings first; restore source order.
  return out.sort((a, b) => a.location.line_start - b.location.line_start || a.location.column_start - b.location.column_start);
}

function visitDefinition(
  node: SgNode, parents: string[], inClass: boolean, out: Entity[],
  stack: Array<[SgNode, string[], boolean]>, fp: string,
): void {
  let def = node;
  const decorators: SgNode[] = [];
  if (node.kind() === 'decorated_definition') {
    for (const c of node.children()) {
      if (c.kind() === 'decorator') decorators.push(c);
      else if (c.kind() === 'function_definition' || c.kind() === 'class_definition') def = c;
    }
    if (def === node) return;
  }
  const name = findChildText(def, 'identifier');
  if (!name) return;
  const isClass = def.kind() === 'class_definition';
  const kind: EntityKind = isClass ? 'class' : inClass ? 'method' : 'function';
  out.push(makeEntity(def, name, kind, isClass ? 'public' : pythonVisibility(name), fp, LANG, parents));
  for (const dec of decorators) {
    const dn = decoratorName(dec);
    if (!dn) continue;
    const e = makeEntity(dec, `@${dn}`, 'decorator', 'public', fp, LANG, [...parents, name]);
    e.name = dn;
    out.push(e);
  }
  if (isClass) {
    const body = findChild(def, 'block');
    if (body) stack.push([body, [...parents, name], true]);
  }
}

function visitAssignment(node: SgNode, parents: string[], inClass: boolean, out: Entity[], fp: string): void {
  const assign = findChild(node, 'assignment');
  if (!assign) return;
  const target = assign.children()[0];
  if (!target || target.kind() !== 'identifier') return;
  const name = target.text();
  out.push(makeEntity(assign, name, inClass ? 'field' : 'variable', pythonVisibility(name), fp, LANG, parents));
}

export const pythonExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.py'],
  supportedRelationTypes: [
    'import', 'call', 'extend', 'override', 'contain', 'create', 'decorate',
  ] as RelationType[],
  cognitiveComplexity: true,
  extractEntities,
  extractSymbols(root, filePath, _entities, rootDir) {
    return extractPythonSymbols(root, filePath, rootDir);
  },
  extractRelations(root, filePath, entities, rootDir, symbols) {
    return extractPythonRelations(root, filePath, entities, symbols ?? extractPythonSymbols(root, filePath, rootDir));
  },
};
