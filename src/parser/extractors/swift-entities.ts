/**
 * Swift entity extraction (split from swift-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityKind, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'swift';

/** Resolve Swift visibility from modifiers. */
function swiftVis(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'internal';
  for (const c of mods.children()) {
    const t = c.text();
    if (t === 'public' || t === 'open') return 'public';
    if (t === 'private') return 'private';
    if (t === 'fileprivate') return 'private';
    if (t === 'internal') return 'internal';
  }
  return 'internal';
}

/** Extract decorator names from modifiers. */
function extractDecorators(
  node: SgNode, parents: string[], fp: string, out: Entity[],
): void {
  const mods = findChild(node, 'modifiers');
  if (!mods) return;
  for (const c of mods.children()) {
    if (c.kind() === 'attribute') {
      // @attributeName — get the user_type > type_identifier
      const ut = findChild(c, 'user_type');
      const name = ut ? findChildText(ut, 'type_identifier') : null;
      if (name) {
        out.push(makeEntity(c, name, 'decorator', 'public', fp, LANG, parents));
      }
    }
  }
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
      case 'protocol_declaration': handleProtocol(node, parents); break;
      case 'function_declaration': handleFunction(node, parents, inClass); break;
      case 'init_declaration': handleInit(node, parents, inClass); break;
      case 'property_declaration': handleProperty(node, parents, inClass); break;
      default: walk(node, parents, inClass);
    }
  }

  function handleClassDecl(node: SgNode, parents: string[]): void {
    // class_declaration covers class, struct, and enum in Swift's grammar
    const isStruct = node.children().some((c: SgNode) => c.kind() === 'struct');
    const isEnum = node.children().some((c: SgNode) => c.kind() === 'enum');

    const name = findChildText(node, 'type_identifier');
    if (!name) return;

    if (isEnum) {
      out.push(makeEntity(node, name, 'enum', swiftVis(node), fp, LANG, parents));
      extractDecorators(node, parents, fp, out);
      const enumBody = findChild(node, 'enum_class_body');
      if (enumBody) {
        for (const c of enumBody.children()) {
          if (c.kind() === 'enum_entry') {
            const vname = findChildText(c, 'simple_identifier');
            if (vname) {
              out.push(makeEntity(c, vname, 'enum_member', 'public', fp, LANG, [...parents, name]));
            }
          }
        }
      }
      return;
    }

    const kind: EntityKind = isStruct ? 'class' : 'class';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
    extractDecorators(node, parents, fp, out);

    const body = findChild(node, 'class_body');
    if (body) walk(body, [...parents, name], true);
  }

  function handleProtocol(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'interface', swiftVis(node), fp, LANG, parents));
    const body = findChild(node, 'protocol_body');
    if (body) {
      for (const c of body.children()) {
        if (c.kind() === 'protocol_function_declaration') {
          const mn = findChildText(c, 'simple_identifier');
          if (mn) {
            out.push(makeEntity(c, mn, 'method', 'public', fp, LANG, [...parents, name]));
          }
        } else if (c.kind() === 'protocol_property_declaration') {
          const pn = findPropertyName(c);
          if (pn) {
            out.push(makeEntity(c, pn, 'field', 'public', fp, LANG, [...parents, name]));
          }
        }
      }
    }
  }

  function handleFunction(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findChildText(node, 'simple_identifier');
    if (!name) return;
    const kind: EntityKind = inClass ? 'method' : 'function';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
  }

  function handleInit(node: SgNode, parents: string[], _inClass: boolean): void {
    out.push(makeEntity(node, 'init', 'method', swiftVis(node), fp, LANG, parents));
  }

  function handleProperty(node: SgNode, parents: string[], inClass: boolean): void {
    const name = findPropertyName(node);
    if (!name) return;
    const kind: EntityKind = inClass ? 'field' : 'variable';
    out.push(makeEntity(node, name, kind, swiftVis(node), fp, LANG, parents));
  }

  walk(root, [], false);
  return out;
}

/** Extract property name from a property_declaration. */
export function findPropertyName(node: SgNode): string | null {
  for (const c of node.children()) {
    if (c.kind() === 'pattern') {
      return findChildText(c, 'simple_identifier');
    }
  }
  return null;
}
