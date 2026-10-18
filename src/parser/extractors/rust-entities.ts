/**
 * Rust entity extraction (split from rust-extractor.ts in Phase 12;
 * no behaviour change).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, Visibility } from '../../contracts/entities.js';
import { findChild, findChildText } from '../extractor-helpers.js';
import { makeEntity } from './entity-builder.js';

export const LANG = 'rust';

/** Rust visibility: `pub` = public, otherwise internal. */
function rustVis(node: SgNode): Visibility {
  const vis = findChild(node, 'visibility_modifier');
  return vis ? 'public' : 'internal';
}

// ─── Entity Extraction ──────────────────────────────────────────

export function extractEntities(root: SgNode, fp: string): Entity[] {
  const out: Entity[] = [];

  function walk(node: SgNode, parents: string[]): void {
    for (const c of node.children()) visit(c, parents);
  }

  function visit(node: SgNode, parents: string[]): void {
    switch (node.kind()) {
      case 'struct_item': handleStruct(node, parents); break;
      case 'enum_item': handleEnum(node, parents); break;
      case 'trait_item': handleTrait(node, parents); break;
      case 'function_item': handleFunction(node, parents); break;
      case 'impl_item': handleImpl(node, parents); break;
      case 'let_declaration': handleLet(node, parents); break;
      case 'const_item': handleConst(node, parents); break;
      case 'static_item': handleStatic(node, parents); break;
      default: walk(node, parents);
    }
  }

  function handleStruct(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'class', rustVis(node), fp, LANG, parents));
    const fdl = findChild(node, 'field_declaration_list');
    if (fdl) {
      for (const c of fdl.children()) {
        if (c.kind() !== 'field_declaration') continue;
        const fname = findChildText(c, 'field_identifier');
        if (fname) {
          const vis = findChild(c, 'visibility_modifier') ? 'public' : 'internal';
          out.push(makeEntity(c, fname, 'field', vis, fp, LANG, [...parents, name]));
        }
      }
    }
  }

  function handleEnum(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'enum', rustVis(node), fp, LANG, parents));
    const variants = findChild(node, 'enum_variant_list');
    if (!variants) return;
    for (const c of variants.children()) {
      if (c.kind() !== 'enum_variant') continue;
      const vname = findChildText(c, 'identifier');
      if (vname) {
        out.push(makeEntity(c, vname, 'enum_member', 'public', fp, LANG, [...parents, name]));
      }
    }
  }

  function handleTrait(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'type_identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'interface', rustVis(node), fp, LANG, parents));
    const dl = findChild(node, 'declaration_list');
    if (dl) {
      for (const c of dl.children()) {
        if (c.kind() === 'function_signature_item' || c.kind() === 'function_item') {
          const mn = findChildText(c, 'identifier');
          if (mn) {
            out.push(makeEntity(c, mn, 'method', 'public', fp, LANG, [...parents, name]));
          }
        }
      }
    }
  }

  function handleFunction(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'function', rustVis(node), fp, LANG, parents));
  }

  function handleImpl(node: SgNode, parents: string[]): void {
    // Find the type being implemented
    const typeIds = node.children().filter(
      (c: SgNode) => c.kind() === 'type_identifier',
    );
    // impl Trait for Type -> 2 type_identifiers (trait, type)
    // impl Type -> 1 type_identifier
    const implType = typeIds.length >= 2 ? typeIds[1].text() : typeIds[0]?.text();
    if (!implType) return;

    const dl = findChild(node, 'declaration_list');
    if (!dl) return;
    for (const c of dl.children()) {
      if (c.kind() === 'function_item') {
        const mn = findChildText(c, 'identifier');
        if (mn) {
          out.push(makeEntity(c, mn, 'method', rustVis(c), fp, LANG, [...parents, implType]));
        }
      }
    }
  }

  function handleLet(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name || name === '_') return;
    out.push(makeEntity(node, name, 'variable', 'internal', fp, LANG, parents));
  }

  function handleConst(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'variable', rustVis(node), fp, LANG, parents));
  }

  function handleStatic(node: SgNode, parents: string[]): void {
    const name = findChildText(node, 'identifier');
    if (!name) return;
    out.push(makeEntity(node, name, 'variable', rustVis(node), fp, LANG, parents));
  }

  walk(root, []);
  return out;
}
