/**
 * Data relation extraction: use, contain, create.
 *
 * Detects data-flow and structural relationships: variable usage,
 * parent-child containment, and object instantiation.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import {
  walkNodes,
  buildEntityNameMap,
  findContainingEntity,
  getCallExpressionCallee,
} from './shared.js';

// ─── Public API ─────────────────────────────────────────────────

export function extractDataRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);

  extractContainRelations(entities, filePath, relations);
  extractCreateRelations(root, filePath, entities, entityByName, relations);
  extractUseRelations(root, filePath, entities, entityByName, relations);
}

// ─── Contain Relations ──────────────────────────────────────────

/**
 * Class -> field, class -> method, namespace -> member containment.
 * Uses the entity hierarchy (qualified_name) to establish parent-child.
 */
function extractContainRelations(
  entities: Entity[],
  filePath: string,
  relations: Relation[],
): void {
  // Build a map of qualified_name prefix -> parent entity
  const parentEntities = entities.filter(
    e => (e.kind === 'class' || e.kind === 'namespace' || e.kind === 'interface' || e.kind === 'enum') &&
         e.file === filePath,
  );

  for (const parent of parentEntities) {
    // Children have qualified_name like: "filePath/Parent.child"
    const prefix = parent.qualified_name + '.';
    for (const child of entities) {
      if (child.file !== filePath) continue;
      if (child === parent) continue;
      // Only direct children: match prefix but no further dots after
      if (!child.qualified_name.startsWith(prefix)) continue;
      const remainder = child.qualified_name.slice(prefix.length);
      if (remainder.includes('.')) continue; // skip nested grandchildren

      // Only structural members: field, method, enum_member
      if (child.kind !== 'field' && child.kind !== 'method' && child.kind !== 'enum_member') continue;

      relations.push({
        id: generateRelationId(parent.id, child.id, 'contain', filePath, parent.location.line_start),
        from: parent.id,
        to: child.id,
        type: 'contain',
        location: { file: filePath, line: parent.location.line_start, column: parent.location.column_start },
        weight: 1,
        confidence: 1.0,
      });
    }
  }
}

// ─── Create Relations ───────────────────────────────────────────

/**
 * `new_expression` nodes. The constructor target must be a known entity.
 * Excludes throw_statement contexts (handled by type-relations as 'throw').
 */
function extractCreateRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  relations: Relation[],
): void {
  walkNodes(root, (node) => {
    if (node.kind() !== 'new_expression') return;

    // Skip if inside a throw statement (those are 'throw' relations)
    if (isInsideThrow(node)) return;

    const className = extractNewTarget(node);
    if (!className) return;

    const targetEntity = entityByName.get(className);
    if (!targetEntity) return;
    if (targetEntity.kind !== 'class') return;

    const fromEntity = findContainingEntity(node, entities, filePath);
    if (!fromEntity) return;

    const range = node.range();
    const line = range.start.line + 1;
    const column = range.start.column + 1;

    relations.push({
      id: generateRelationId(fromEntity.id, targetEntity.id, 'create', filePath, line),
      from: fromEntity.id,
      to: targetEntity.id,
      type: 'create',
      location: { file: filePath, line, column },
      weight: 1,
      confidence: 1.0,
    });
  });
}

// ─── Use Relations ──────────────────────────────────────────────

/**
 * Variable references and property accesses that are NOT function calls.
 * Only created when the referenced identifier is a known entity.
 */
function extractUseRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  relations: Relation[],
): void {
  // Track which identifiers are call targets to exclude them
  const callTargetPositions = new Set<string>();
  walkNodes(root, (node) => {
    if (node.kind() !== 'call_expression') return;
    const callee = getCallExpressionCallee(node);
    if (!callee) return;
    // Mark the callee identifier position
    if (callee.kind() === 'identifier') {
      const r = callee.range();
      callTargetPositions.add(`${r.start.line}:${r.start.column}`);
    }
    if (callee.kind() === 'member_expression') {
      const r = callee.range();
      callTargetPositions.add(`${r.start.line}:${r.start.column}`);
    }
  });

  // Also mark new_expression targets
  walkNodes(root, (node) => {
    if (node.kind() !== 'new_expression') return;
    for (const child of node.children()) {
      if (child.kind() === 'identifier') {
        const r = child.range();
        callTargetPositions.add(`${r.start.line}:${r.start.column}`);
        break;
      }
    }
  });

  // Now find identifier references that are reads (not calls, not declarations, not imports)
  const seenUses = new Set<string>(); // Deduplicate: "fromId:toId"
  walkNodes(root, (node) => {
    if (node.kind() !== 'identifier') return;

    const name = node.text();
    const targetEntity = entityByName.get(name);
    if (!targetEntity) return;

    // Only reference variable entities (not functions, classes, etc.)
    if (targetEntity.kind !== 'variable') return;

    // Skip if this identifier IS a call target
    const r = node.range();
    const posKey = `${r.start.line}:${r.start.column}`;
    if (callTargetPositions.has(posKey)) return;

    // Skip declaration contexts
    if (isDeclarationContext(node)) return;

    // Skip import contexts
    if (isImportContext(node)) return;

    const fromEntity = findContainingEntity(node, entities, filePath);
    if (!fromEntity) return;

    // Deduplicate same from->to use relations
    const dedupeKey = `${fromEntity.id}:${targetEntity.id}`;
    if (seenUses.has(dedupeKey)) return;
    seenUses.add(dedupeKey);

    const line = r.start.line + 1;
    const column = r.start.column + 1;

    relations.push({
      id: generateRelationId(fromEntity.id, targetEntity.id, 'use', filePath, line),
      from: fromEntity.id,
      to: targetEntity.id,
      type: 'use',
      location: { file: filePath, line, column },
      weight: 1,
      confidence: 1.0,
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────

function extractNewTarget(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
    if (child.kind() === 'arguments') break;
  }
  return null;
}

function isInsideThrow(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    if (current.kind() === 'throw_statement') return true;
    if (current.kind() === 'function_declaration' ||
        current.kind() === 'method_definition' ||
        current.kind() === 'arrow_function') break;
    current = current.parent();
  }
  return false;
}

/** Check if an identifier is in a declaration context (variable_declarator name). */
function isDeclarationContext(node: SgNode): boolean {
  const parent = node.parent();
  if (!parent) return false;
  const pk = parent.kind();
  // Variable declarator: const x = ... — the 'x' is a declaration
  if (pk === 'variable_declarator') {
    // Only if this is the name (first identifier child)
    const firstId = parent.children().find(c => c.kind() === 'identifier');
    if (firstId) {
      const fr = firstId.range();
      const nr = node.range();
      if (fr.start.line === nr.start.line && fr.start.column === nr.start.column) {
        return true;
      }
    }
  }
  // Function/method/class name
  if (pk === 'function_declaration' || pk === 'class_declaration') return true;
  // Required/optional parameter
  if (pk === 'required_parameter' || pk === 'optional_parameter') return true;
  // Formal parameters
  if (pk === 'formal_parameters') return true;
  return false;
}

/** Check if an identifier is inside an import statement. */
function isImportContext(node: SgNode): boolean {
  let current = node.parent();
  while (current) {
    const k = current.kind();
    if (k === 'import_statement' || k === 'import_clause' || k === 'import_specifier') return true;
    if (k === 'program') break;
    current = current.parent();
  }
  return false;
}
