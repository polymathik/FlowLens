/**
 * Import relation extraction: ESM imports, CJS require, dynamic import,
 * re-exports. Resolves specifiers to file paths using the import resolver.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Relation } from '../../contracts/relations.js';
import { generateEntityId, generateRelationId } from '../../utils/id.js';
import { resolveImportPath, resolveBarrelReExports } from '../import-resolver.js';
import { findChild } from '../extractor-helpers.js';
import { walkNodes, getCallExpressionCallee } from './shared.js';
import path from 'node:path';

// ─── Public API ─────────────────────────────────────────────────

export function extractImportRelations(
  root: SgNode,
  filePath: string,
  rootDir: string,
  relations: Relation[],
): void {
  const fileEntityId = generateEntityId(
    filePath,
    path.basename(filePath),
    'file',
  );

  walkNodes(root, (node) => {
    const kind = node.kind();

    if (kind === 'import_statement') {
      handleImportStatement(node, filePath, rootDir, fileEntityId, relations);
    } else if (kind === 'export_statement') {
      handleReExport(node, filePath, rootDir, fileEntityId, relations);
    } else if (kind === 'call_expression') {
      handleDynamicImportOrRequire(node, filePath, rootDir, fileEntityId, relations);
    }
  });
}

// ─── Import Statement ───────────────────────────────────────────

function handleImportStatement(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  const specifier = extractStringSpecifier(node);
  if (!specifier) return;

  const importedNames = extractImportedNames(node);

  createImportRelation(
    specifier, filePath, rootDir, fileEntityId,
    node, 1.0, relations, importedNames,
  );
}

function extractImportedNames(node: SgNode): string[] {
  const names: string[] = [];
  for (const child of node.children()) {
    if (child.kind() === 'import_clause') {
      for (const clauseChild of child.children()) {
        if (clauseChild.kind() === 'named_imports') {
          for (const spec of clauseChild.children()) {
            if (spec.kind() === 'import_specifier') {
              const nameNode = spec.children().find(c => c.kind() === 'identifier');
              if (nameNode) names.push(nameNode.text());
            }
          }
        } else if (clauseChild.kind() === 'identifier') {
          names.push(clauseChild.text());
        }
      }
    }
  }
  return names;
}

// ─── Re-export ──────────────────────────────────────────────────

function handleReExport(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  const specifier = extractStringSpecifier(node);
  if (!specifier) return;

  createImportRelation(
    specifier, filePath, rootDir, fileEntityId,
    node, 1.0, relations,
  );
}

// ─── Dynamic Import / Require ───────────────────────────────────

function handleDynamicImportOrRequire(
  node: SgNode,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  relations: Relation[],
): void {
  const functionPart = getCallExpressionCallee(node);
  if (!functionPart) return;

  const isRequire = functionPart.kind() === 'identifier' && functionPart.text() === 'require';
  const isDynamicImport = functionPart.kind() === 'import';

  if (!isRequire && !isDynamicImport) return;

  const args = findChild(node, 'arguments');
  if (!args) return;

  const isConditional = isDynamicImport && isInsideConditional(node);

  for (const arg of args.children()) {
    if (arg.kind() === 'string') {
      const fragment = findChild(arg, 'string_fragment');
      if (fragment) {
        const confidence = isConditional ? 0.5 : 1.0;
        createImportRelation(
          fragment.text(), filePath, rootDir, fileEntityId,
          node, confidence, relations,
        );
      }
      return;
    }
    if (arg.kind() === 'template_string') {
      const fragment = findChild(arg, 'string_fragment');
      if (fragment) {
        const confidence = isConditional ? 0.5 : 0.75;
        createImportRelation(
          fragment.text(), filePath, rootDir, fileEntityId,
          node, confidence, relations,
        );
      }
      return;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function extractStringSpecifier(node: SgNode): string | null {
  for (const child of node.children()) {
    if (child.kind() === 'string') {
      const fragment = findChild(child, 'string_fragment');
      return fragment ? fragment.text() : null;
    }
  }
  return null;
}

function isInsideConditional(node: SgNode): boolean {
  const CONDITIONAL_KINDS = new Set([
    'if_statement', 'ternary_expression', 'conditional_expression',
  ]);
  let current = node.parent();
  while (current) {
    const k = String(current.kind());
    if (CONDITIONAL_KINDS.has(k)) return true;
    if (k === 'function_declaration' || k === 'program') break;
    current = current.parent();
  }
  return false;
}

function createImportRelation(
  specifier: string,
  filePath: string,
  rootDir: string,
  fileEntityId: string,
  node: SgNode,
  confidence: number,
  relations: Relation[],
  importedNames?: string[],
): void {
  const resolved = resolveImportPath(specifier, filePath, rootDir);
  if (!resolved) return;

  const range = node.range();
  const line = range.start.line + 1;
  const column = range.start.column + 1;

  if (rootDir && importedNames && importedNames.length > 0) {
    const reExports = resolveBarrelReExports(resolved, importedNames, rootDir);
    if (reExports.size > 0) {
      const targetFiles = new Set(reExports.values());
      for (const targetFile of targetFiles) {
        const targetEntityId = generateEntityId(
          targetFile,
          path.basename(targetFile),
          'file',
        );
        relations.push({
          id: generateRelationId(fileEntityId, targetEntityId, 'import', filePath, line),
          from: fileEntityId,
          to: targetEntityId,
          type: 'import',
          location: { file: filePath, line, column },
          weight: 1,
          confidence,
        });
      }
      return;
    }
  }

  const targetEntityId = generateEntityId(
    resolved,
    path.basename(resolved),
    'file',
  );

  relations.push({
    id: generateRelationId(fileEntityId, targetEntityId, 'import', filePath, line),
    from: fileEntityId,
    to: targetEntityId,
    type: 'import',
    location: { file: filePath, line, column },
    weight: 1,
    confidence,
  });
}
