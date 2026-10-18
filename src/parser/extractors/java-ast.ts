/**
 * Small Java AST helpers shared by the entity extractor and java-relations.ts
 * (kept separate so the two modules do not import each other).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Visibility } from '../../contracts/entities.js';
import { findChild } from '../extractor-helpers.js';

export function javaVisibility(node: SgNode): Visibility {
  const mods = findChild(node, 'modifiers');
  if (!mods) return 'internal';
  for (const c of mods.children()) {
    const k = c.kind();
    if (k === 'public' || k === 'private' || k === 'protected') return k as Visibility;
  }
  return 'internal';
}

/** Annotation nodes in a declaration's modifiers. */
export function annotationsOf(node: SgNode): SgNode[] {
  const mods = findChild(node, 'modifiers');
  if (!mods) return [];
  return mods.children().filter((c) => c.kind() === 'marker_annotation' || c.kind() === 'annotation');
}

export function annotationName(node: SgNode): string | null {
  const id = node.children().find((c) => c.kind() === 'identifier' || c.kind() === 'scoped_identifier');
  return id ? id.text() : null;
}
