/**
 * Kotlin entity extraction (split from kotlin-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'kotlin';

function ktVis(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'public';
  for (const c of mods.children()) {
    if (c.kind() === 'visibility_modifier') {
      const t = c.text().trim();
      if (t === 'private') return 'private';
      if (t === 'protected') return 'protected';
      if (t === 'internal') return 'internal';
    }
  }
  return 'public';
}

// ─── Entity Extraction ──────────────────────────────────────────

export function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[], inClass: boolean): void {
    for (const c of node.children()) visit(c, parents, inClass);
  }

  function visit(node: SgNode, parents: string[], inClass: boolean): void {
    switch (node.kind()) {
      case 'class_declaration': handleClassDecl(node, parents); break;
      case 'object_declaration': handleObject(node, parents); break;
      case 'function_declaration': handleFunc(node, parents, inClass); break;
      case 'property_declaration': handleProp(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClassDecl(node: SgNode, parents: string[]): void {
    let kind: EntityKind = 'class';
    let isAnnotation = false;
    const hasIface = findChild(node, 'interface');
    const hasEnum = findChild(node, 'enum');
    const mods = findChild(node, 'modifiers');

    if (hasIface) kind = 'interface';
    else if (hasEnum) kind = 'enum';
    if (mods) for (const c of mods.children()) {
      if (c.kind() === 'class_modifier' && c.text().trim() === 'annotation') isAnnotation = true;
    }

    const name = findChildText(node, 'type_identifier');
    if (!name) return;

    if (isAnnotation) {
      out.push(makeEntity(node, name, 'decorator', ktVis(node), fp, LANG, parents));
      return;
    }

    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);

    if (kind === 'enum') {
      const eb = findChild(node, 'enum_class_body');
      if (eb) for (const c of eb.children()) {
        if (c.kind() === 'enum_entry') {
          const en = findChildText(c, 'simple_identifier');
          if (en) out.push(makeEntity(c, en, 'enum_member', 'public', fp, LANG, [...parents, name]));
        }
      }
      return;
    }

    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleObject(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', ktVis(node), fp, LANG, parents));
    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleFunc(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
    extractAnnotations(node, parents);
  }

  function handleProp(node: SgNode, parents: string[], inClass: boolean): void {
    const vd = findChild(node, 'variable_declaration');
    const name = vd ? findChildText(vd, 'simple_identifier') : findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, ktVis(node), fp, LANG, parents));
  }

  function extractAnnotations(node: SgNode, parents: string[]): void {
    const mods = findChild(node, 'modifiers');
    if (!mods) return;
    for (const c of mods.children()) {
      if (c.kind() !== 'annotation') continue;
      const ci = findChild(c, 'constructor_invocation');
      const ut = ci ? findChild(ci, 'user_type') : findChild(c, 'user_type');
      const tn = ut ? findChildText(ut, 'type_identifier') : null;
      if (tn) out.push(makeEntity(c, tn, 'decorator', 'public', fp, LANG, parents));
    }
  }

  walk(root, [], false);
  return out;
}
