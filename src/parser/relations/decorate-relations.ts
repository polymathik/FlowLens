/**
 * Decorate relation extraction: @Decorator on classes, methods, fields.
 *
 * The decorator expression is the source; the decorated entity
 * (class/method/property) is the target.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity } from '../../contracts/entities.js';
import type { Relation } from '../../contracts/relations.js';
import { generateRelationId } from '../../utils/id.js';
import { findChild } from '../extractor-helpers.js';
import { walkNodes, buildEntityNameMap } from './shared.js';

// ─── Public API ─────────────────────────────────────────────────

export function extractDecorateRelations(
  root: SgNode,
  filePath: string,
  entities: Entity[],
  relations: Relation[],
): void {
  const entityByName = buildEntityNameMap(entities);

  walkNodes(root, (node) => {
    if (node.kind() !== 'decorator') return;

    const decoratorName = extractDecoratorSourceName(node);
    if (!decoratorName) return;

    const decoratorEntity = entities.find(
      e => e.kind === 'decorator' && e.name === decoratorName && e.file === filePath,
    );

    const parent = node.parent();
    if (!parent) return;

    const targetEntity = findDecoratedEntity(parent, node, entities, entityByName, filePath);
    if (!targetEntity) return;

    const sourceId = decoratorEntity ? decoratorEntity.id : `unresolved:${decoratorName}`;
    const range = node.range();
    const line = range.start.line + 1;
    const column = range.start.column + 1;

    relations.push({
      id: generateRelationId(sourceId, targetEntity.id, 'decorate', filePath, line),
      from: sourceId,
      to: targetEntity.id,
      type: 'decorate',
      location: { file: filePath, line, column },
      weight: 1,
      confidence: decoratorEntity ? 1.0 : 0.5,
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────

function extractDecoratorSourceName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'identifier') return child.text();
    if (child.kind() === 'call_expression') {
      const id = findChild(child, 'identifier');
      if (id) return id.text();
    }
  }
  return null;
}

function findDecoratedEntity(
  parent: SgNode,
  decoratorNode: SgNode,
  entities: Entity[],
  entityByName: Map<string, Entity>,
  filePath: string,
): Entity | undefined {
  const pk = parent.kind();

  if (pk === 'class_declaration') {
    const name = findClassDeclName(parent);
    if (name) return entityByName.get(name);
  }

  if (pk === 'method_definition') {
    const name = findMethodDeclName(parent);
    if (name) {
      return entities.find(e => e.name === name && e.kind === 'method' && e.file === filePath);
    }
  }

  if (pk === 'class_body') {
    const siblings = parent.children();
    let foundDecorator = false;
    for (const sibling of siblings) {
      if (foundDecorator) {
        if (sibling.kind() === 'method_definition') {
          const name = findMethodDeclName(sibling);
          if (name) return entities.find(e => e.name === name && e.kind === 'method' && e.file === filePath);
        }
        if (sibling.kind() === 'public_field_definition') {
          const name = findFieldDeclName(sibling);
          if (name) return entities.find(e => e.name === name && e.kind === 'field' && e.file === filePath);
        }
        break;
      }
      if (sibling.range().start.line === decoratorNode.range().start.line &&
          sibling.range().start.column === decoratorNode.range().start.column) {
        foundDecorator = true;
      }
    }
  }

  return undefined;
}

function findClassDeclName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'type_identifier' || child.kind() === 'identifier') {
      return child.text();
    }
  }
  return null;
}

function findMethodDeclName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'property_identifier') return child.text();
  }
  return null;
}

function findFieldDeclName(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'property_identifier' || child.kind() === 'private_property_identifier') {
      return child.text();
    }
  }
  return null;
}
