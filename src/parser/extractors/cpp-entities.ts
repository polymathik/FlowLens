/**
 * C++ entity extraction (split from cpp-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'cpp';

/** Resolve visibility from the last access_specifier seen before this node. */
function cppMemberVis(node: SgNode): Visibility {
  // Walk backwards through siblings to find the nearest access_specifier
  let prev = node.prev();
  while (prev) {
    if (prev.kind() === 'access_specifier') {
      const text = prev.text().replace(':', '').trim();
      if (text === 'public') return 'public';
      if (text === 'private') return 'private';
      if (text === 'protected') return 'protected';
    }
    prev = prev.prev();
  }
  // C++ class members are private by default
  return 'private';
}

// ─── Entity Extraction ──────────────────────────────────────────

export function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_specifier': handleClass(node, parents); break;
      case 'struct_specifier': handleStruct(node, parents); break;
      case 'namespace_definition': handleNamespace(node, parents); break;
      case 'function_definition': handleFunction(node, parents, inClass); break;
      case 'declaration': handleDeclaration(node, parents, inClass); break;
      case 'field_declaration': handleField(node, parents); break;
      case 'preproc_include': break; // relations only
      default: walk(node, parents, inClass);
    }
  }

  function handleClass(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) walk(fdl, [...parents, name], true);
  }

  function handleStruct(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', 'public', fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) walk(fdl, [...parents, name], true);
  }

  function handleNamespace(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'namespace_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'namespace', 'public', fp, LANG, parents));
    const dl = findChild(node, 'declaration_list');
    if (dl) walk(dl, [...parents, name], false);
  }

  function handleFunction(node: SgNode, parents: string[], inClass: boolean): void {
    const decl = findChild(node, 'function_declarator');
    if (!decl) return;
    // method if inside class or has field_identifier
    const fieldId = findChildText(decl, 'field_identifier');
    const id = findChildText(decl, 'identifier');
    const name = fieldId ?? id;
    if (!name) return;

    const kind: EntityKind = inClass ? 'method' : 'function';
    const vis: Visibility = inClass ? cppMemberVis(node) : 'public';
    out.push(makeEntity(node, name, kind, vis, fp, LANG, parents));
  }

  function handleField(node: SgNode, parents: string[]): void {
    // Field declaration inside a class (with field_identifier or identifier)
    const fid = findChildText(node, 'field_identifier');
    if (fid) {
      out.push(makeEntity(node, fid, 'field', cppMemberVis(node), fp, LANG, parents));
      return;
    }
    // Check for function_declarator (method declaration, not field)
    if (findChild(node, 'function_declarator')) return;
  }

  function handleDeclaration(node: SgNode, parents: string[], inClass: boolean): void {
    // Check for nested class/struct
    const classSpec = findChild(node, 'class_specifier');
    if (classSpec) { handleClass(classSpec, parents); return; }
    const structSpec = findChild(node, 'struct_specifier');
    if (structSpec) { handleStruct(structSpec, parents); return; }

    // Variable declaration
    const initDecl = findChild(node, 'init_declarator');
    if (initDecl) {
      const name = findChildText(initDecl, 'identifier');
      if (name) {
        const kind: EntityKind = inClass ? 'field' : 'variable';
        out.push(makeEntity(node, name, kind, 'public', fp, LANG, parents));
      }
    }
  }

  walk(root, [], false);
  return out;
}
