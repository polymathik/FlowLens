/**
 * Data relation extraction (TS/JS): contain, create / throw, use.
 *
 * - contain: class / interface / enum / namespace → direct members, from
 *   the qualified-name hierarchy of extracted entities.
 * - create / throw: `new X()` (inside a `throw` statement it is a throw).
 * - use: reads of variables (local, or imported — optional in pass 2 so
 *   references to imported functions/classes are not reported as errors).
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import type { ScopeFrame, TsRelationContext } from './ts-context.js';
import { ownerOptions, refText, sameNode } from './ts-context.js';
import { handleReferenceIdentifier } from './reference-relations.js';
import { generateRelationId } from '../../utils/id.js';

const CONTAINER_KINDS = new Set(['class', 'namespace', 'interface', 'enum', 'variable']); // a variable holds the function members of an object literal
const MEMBER_KINDS = new Set(['field', 'method', 'enum_member']);

/** Containment edges for one file (members are direct children by qualified name). */
export function containRelations(entities: Entity[], filePath: string): Relation[] {
  const containers = new Map<string, Entity>();
  for (const e of entities) if (CONTAINER_KINDS.has(e.kind) && e.file === filePath) containers.set(e.qualified_name, e);
  const out: Relation[] = [];
  for (const child of entities) {
    if (!MEMBER_KINDS.has(child.kind) || child.file !== filePath) continue;
    const dot = child.qualified_name.lastIndexOf('.');
    const slash = child.qualified_name.lastIndexOf('/');
    if (dot <= slash) continue;
    const parent = containers.get(child.qualified_name.slice(0, dot));
    if (!parent) continue;
    const line = parent.location.line_start;
    out.push({
      id: generateRelationId(parent.id, child.id, 'contain', filePath, line),
      from: parent.id,
      to: child.id,
      type: 'contain',
      location: { file: filePath, line, column: parent.location.column_start },
      weight: 1,
      confidence: 1,
    });
  }
  return out;
}

export function handleNew(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.entity) return;
  const ctor = node.children().find((c) => c.kind() !== 'new');
  const name = ctor ? refText(ctor) : null;
  if (!name) return;
  ctx.emitter.link(frame.entity, frame.inThrow ? 'throw' : 'create', name, node, ownerOptions(frame, ctx));
}

/** Identifier contexts that are declarations, call/new targets or keys — not reads. */
const NON_READ_PARENTS = new Set([
  'variable_declarator', 'function_declaration', 'generator_function_declaration',
  'class_declaration', 'abstract_class_declaration', 'class', 'required_parameter',
  'optional_parameter', 'formal_parameters', 'import_specifier', 'import_clause',
  'namespace_import', 'export_specifier', 'method_definition', 'labeled_statement',
  'catch_clause', 'arrow_function', 'for_in_statement', 'shorthand_property_identifier_pattern',
  'pair_pattern', 'object_pattern', 'array_pattern', 'assignment_pattern', 'rest_pattern',
  'internal_module', 'enum_declaration', 'decorator', 'class_heritage', 'extends_clause',
  'implements_clause',
]);

const FIRST_IS_DECL = new Set(['variable_declarator', 'arrow_function', 'for_in_statement']);

export function handleIdentifierUse(node: SgNode, frame: ScopeFrame, ctx: TsRelationContext): void {
  if (!frame.entity) return;
  const name = node.text();
  if (!ctx.emitter.isLocal(name) && !ctx.emitter.isImported(name)) return;
  // Hand-off positions (call arguments, route tables, JSX attributes) are references to
  // functions / classes too, also at module scope (reference-relations.ts).
  if (handleReferenceIdentifier(node, name, frame, ctx)) return;
  // Plain module-scope reads (`const x = CONFIG`) stay unrecorded: only calls, `new` and
  // hand-off references are attributed to the file entity.
  if (ctx.ownerIsFile && frame.entity.id === ctx.rootOwner.id) return;
  const parent = node.parent();
  if (!parent) return;
  const pk = String(parent.kind());
  if (NON_READ_PARENTS.has(pk)) {
    // `const x = y`, `x => y`, `for (k in o)` — only the first identifier is a declaration
    if (!FIRST_IS_DECL.has(pk) || sameNode(parent.children().find((c) => c.kind() === 'identifier'), node)) return;
  }
  if ((pk === 'call_expression' || pk === 'new_expression') && isCallee(parent, node)) return;
  ctx.emitter.link(frame.entity, 'use', name, node, { optional: true });
}

function isCallee(parent: SgNode, node: SgNode): boolean {
  const first = parent.children().find((c) => c.kind() !== 'new');
  return sameNode(first, node);
}
