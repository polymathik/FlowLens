/**
 * Go language extractor.
 *
 * Extracts entities (classes/structs, interfaces, functions, methods,
 * fields, variables) and relations (import, call, use, contain, create,
 * implement) from Go ASTs parsed by tree-sitter.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import type { RelationType } from '../../contracts/relations.js';
import type { LanguageExtractor } from '../../contracts/language-extractor.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';
import { extractGoSymbols } from './go-symbols.js';
import { extractGoRelations } from './go-relations.js';

const LANG = 'go';

/** Go exports by capitalisation: uppercase first letter = public. */
function goVis(name: string): Visibility {
  return name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
    ? 'public' : 'internal';
}

// ─── Entity Extraction ──────────────────────────────────────────

function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'type_declaration': handleTypeDecl(node, parents); break;
      case 'function_declaration': handleFunc(node, parents); break;
      case 'method_declaration': handleMethod(node, parents); break;
      case 'var_declaration': handleVar(node, parents, inClass); break;
      case 'short_var_declaration': handleShortVar(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleTypeDecl(node: SgNode, parents: string[]): void {
    for (const c of node.children()) {
      if (c.kind() !== 'type_spec') continue;
      const name = findChildText(c, 'type_identifier');
      if (!name) continue;

      const structType = findChild(c, 'struct_type');
      if (structType) {
        out.push(makeEntity(c, name, 'class', goVis(name), fp, LANG, parents));
        handleStructFields(structType, [...parents, name]);
        continue;
      }
      const ifaceType = findChild(c, 'interface_type');
      if (ifaceType) {
        out.push(makeEntity(c, name, 'interface', goVis(name), fp, LANG, parents));
        continue;
      }
    }
  }

  function handleStructFields(structNode: SgNode, parents: string[]): void {
    const fdl = findChild(structNode, 'field_declaration_list');
    if (!fdl) return;
    for (const c of fdl.children()) {
      if (c.kind() !== 'field_declaration') continue;
      for (const id of c.children()) {
        if (id.kind() !== 'field_identifier') continue;
        out.push(makeEntity(c, id.text(), 'field', goVis(id.text()), fp, LANG, parents));
      }
    }
  }

  function handleFunc(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', goVis(name), fp, LANG, parents));
  }

  function handleMethod(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'field_identifier');
    if (!name) return;
    // Determine receiver type to build proper qualified name
    const paramList = node.children().find(
      (c: SgNode) => c.kind() === 'parameter_list',
    );
    let receiverType: string | null = null;
    if (paramList) {
      const pd = findChild(paramList, 'parameter_declaration');
      if (pd) {
        receiverType = findChildText(pd, 'type_identifier');
        if (!receiverType) {
          const ptr = findChild(pd, 'pointer_type');
          if (ptr) receiverType = findChildText(ptr, 'type_identifier');
        }
      }
    }
    const methodParents = receiverType ? [...parents, receiverType] : parents;
    out.push(makeEntity(node, name, 'method', goVis(name), fp, LANG, methodParents));
  }

  function handleVar(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) {
      if (c.kind() !== 'var_spec') continue;
      const name = findChildText(c, 'identifier');
      if (name) {
        const kind: EntityKind = inClass ? 'field' : 'variable';
        out.push(makeEntity(c, name, kind, goVis(name), fp, LANG, parents));
      }
    }
  }

  function handleShortVar(node: SgNode, parents: string[], inClass: boolean): void {
    // expression_list on the left contains identifiers
    for (const c of node.children()) {
      if (c.kind() !== 'expression_list') continue;
      for (const id of c.children()) {
        if (id.kind() === 'identifier') {
          const name = id.text();
          if (name === '_') continue;
          const kind: EntityKind = inClass ? 'field' : 'variable';
          out.push(makeEntity(id, name, kind, 'internal', fp, LANG, parents));
        }
      }
      break; // only first expression_list is lhs
    }
  }

  walk(root, [], false);
  return out;
}

export const goExtractor: LanguageExtractor = {
  language: LANG,
  extensions: ['.go'],
  supportedRelationTypes: ['import', 'call', 'contain', 'create'] as RelationType[],
  cognitiveComplexity: true,
  extractEntities,
  extractSymbols(root, filePath, _entities, rootDir) {
    return extractGoSymbols(root, filePath, rootDir);
  },
  extractRelations(root, filePath, entities, rootDir, symbols) {
    return extractGoRelations(root, filePath, entities, symbols ?? extractGoSymbols(root, filePath, rootDir));
  },
};
