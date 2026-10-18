/**
 * Import relation extraction (TS/JS): ESM imports, re-exports, CommonJS
 * `require`, dynamic `import()`.
 *
 * - The specifier is resolved with the shared module resolver (relative
 *   paths, `.js`→`.ts` mapping, tsconfig paths, workspace packages).
 * - A resolved specifier gives a direct file→file edge; `import type` marks
 *   it `meta.type_only`.
 * - A project-internal specifier that names no file becomes an explicit
 *   unresolved import (never a fabricated id); external packages are dropped.
 * - Every named binding also yields an optional pending import to the file
 *   that *declares* the name, so barrels (`export *`) link the importer to
 *   the real source module in pass 2.
 */
import type { SgNode } from '@ast-grep/napi';
import { findChild } from '../extractor-helpers.js';
import { resolveModuleSpecifier } from '../resolution/ts-module-resolver.js';
import { stringSpecifier } from '../symbols/ts-symbols.js';
import { loc } from '../symbols/emitter.js';
import { generateRelationId } from '../../utils/id.js';
import type { TsRelationContext } from './ts-context.js';
import { fileEntityIdFor } from './ts-context.js';

/** `import … from '…'` — returns nothing; children need not be walked. */
export function handleImportStatement(node: SgNode, ctx: TsRelationContext): void {
  const specifier = stringSpecifier(node);
  if (specifier === null) return;
  const bindings = ctx.symbols.imports.filter(
    (b) => b.specifier === specifier && b.location.line === loc(node).line,
  );
  const typeOnly = bindings.length > 0 && bindings.every((b) => b.type_only);
  addImportEdge(specifier, node, ctx, 1.0, typeOnly);

  for (const b of bindings) {
    if (!b.local || b.imported === '*' || b.external || !b.source_file) continue;
    ctx.emitter.pending(ctx.fileEntityId, 'import', b.local, node, {
      resolve_to: 'file',
      optional: true,
      meta: { via: b.source_file, ...(b.type_only ? { type_only: true } : {}) },
    });
  }
}

/** `export … from '…'` */
export function handleReExport(node: SgNode, ctx: TsRelationContext): void {
  const specifier = stringSpecifier(node);
  if (specifier === null) return;
  const typeOnly = node.children().some((c) => c.kind() === 'type');
  addImportEdge(specifier, node, ctx, 1.0, typeOnly);
}

/** `require('…')` and `import('…')`. Returns true when the call was an import. */
export function handleRequireOrDynamicImport(node: SgNode, ctx: TsRelationContext): boolean {
  const callee = node.children()[0];
  if (!callee) return false;
  const isRequire = callee.kind() === 'identifier' && callee.text() === 'require';
  const isDynamic = callee.kind() === 'import';
  if (!isRequire && !isDynamic) return false;
  const args = findChild(node, 'arguments');
  if (!args) return true;
  const conditional = isDynamic && isInsideConditional(node);
  for (const arg of args.children()) {
    const k = arg.kind();
    if (k !== 'string' && k !== 'template_string') continue;
    if (k === 'template_string' && arg.children().some((c) => c.kind() === 'template_substitution')) return true;
    const frag = findChild(arg, 'string_fragment');
    if (!frag) return true;
    const confidence = conditional ? 0.5 : k === 'template_string' ? 0.75 : 1.0;
    addImportEdge(frag.text(), node, ctx, confidence, false);
    return true;
  }
  return true;
}

function addImportEdge(
  specifier: string, node: SgNode, ctx: TsRelationContext, confidence: number, typeOnly: boolean,
): void {
  const res = resolveModuleSpecifier(specifier, ctx.filePath, ctx.rootDir);
  const { line, column } = loc(node);
  if (res.file) {
    if (res.file === ctx.filePath) return;
    const to = fileEntityIdFor(res.file);
    ctx.emitter.relations.push({
      id: generateRelationId(ctx.fileEntityId, to, 'import', ctx.filePath, line),
      from: ctx.fileEntityId,
      to,
      type: 'import',
      location: { file: ctx.filePath, line, column },
      weight: 1,
      confidence,
      ...(typeOnly ? { meta: { type_only: true } } : {}),
    });
    return;
  }
  if (res.external || !ctx.rootDir) return;
  ctx.emitter.relations.push({
    id: generateRelationId(ctx.fileEntityId, `?${specifier}`, 'import', ctx.filePath, line),
    from: ctx.fileEntityId,
    to: '',
    type: 'import',
    location: { file: ctx.filePath, line, column },
    weight: 1,
    confidence,
    resolution: 'unresolved',
    target_name: specifier,
    final: true,
    ...(typeOnly ? { meta: { type_only: true } } : {}),
  } as import('../../contracts/symbols.js').PendingRelation);
}

function isInsideConditional(node: SgNode): boolean {
  const CONDITIONAL = new Set(['if_statement', 'ternary_expression', 'conditional_expression']);
  let current = node.parent();
  while (current) {
    const k = String(current.kind());
    if (CONDITIONAL.has(k)) return true;
    if (k === 'function_declaration' || k === 'program') break;
    current = current.parent();
  }
  return false;
}
