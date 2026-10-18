/**
 * Populate metrics on entities by finding their corresponding AST nodes.
 *
 * After entity extraction, this module walks the AST to locate
 * function/method declaration nodes, matches them to extracted entities
 * by location, and computes complexity + Halstead metrics in-place.
 *
 * Coupling metrics (Ca / Ce / instability) are NOT computed here —
 * they are query-time only per the spec.
 */
import type { SgNode } from '@ast-grep/napi';
import type { Entity, EntityMetrics } from '../contracts/entities.js';
import { computeCognitiveComplexity } from './cognitive-complexity.js';
import { computeCyclomaticComplexity } from './cyclomatic-complexity.js';
import { computeHalstead } from './halstead.js';
import { computeQualityScore } from './quality-score.js';
import { walkNodes } from '../parser/ast-walk.js';

export interface PopulateMetricsOptions {
  /** Compute cognitive complexity (only for languages with a verified profile). Default true. */
  cognitive?: boolean;
}

// ─── AST node kinds that represent functions / methods ───────────

/**
 * Tree-sitter node kinds that represent function or method declarations
 * across supported languages. We collect these when walking the AST.
 */
const FUNCTION_NODE_KINDS = new Set([
  // TypeScript / JavaScript
  'function_declaration',
  'method_definition',
  'arrow_function',
  'function_expression',
  'generator_function_declaration',
  // Python
  'function_definition',
  // Java / Kotlin / C# / Go
  'method_declaration',
  'constructor_declaration',
  // Rust
  'function_item',
  // Ruby
  'method',
  // PHP
  'method_declaration',
  'function_definition',
  // C / C++
  'function_definition',
]);

// ─── Node collection ─────────────────────────────────────────────

interface LocatedNode {
  node: SgNode;
  /** 1-based start line (matches Entity.location.line_start) */
  lineStart: number;
  /** 1-based end line */
  lineEnd: number;
}

/**
 * Walk the full AST and collect all function/method declaration nodes
 * with their 1-based line ranges.
 */
function findFunctionNodes(root: SgNode): LocatedNode[] {
  const results: LocatedNode[] = [];
  walkNodes(root, (node) => {
    if (FUNCTION_NODE_KINDS.has(String(node.kind()))) {
      const range = node.range();
      results.push({ node, lineStart: range.start.line + 1, lineEnd: range.end.line + 1 });
    }
  });
  return results;
}

// ─── Node ↔ Entity matching ─────────────────────────────────────

/**
 * Find the AST node that corresponds to an entity.
 *
 * Primary match: same start line. If an entity spans a variable
 * declaration (e.g. `const foo = () => {}`), the entity's line_start
 * matches the declaration, but the actual arrow_function starts on the
 * same or next line. We match by checking if the entity's range
 * encompasses the AST node's range.
 *
 * For arrow-function variables, the entity's location covers the whole
 * `lexical_declaration` while the arrow_function node is a descendant.
 * We prefer exact start-line match first, then fall back to containment.
 */
function matchEntityToNode(
  entity: Entity,
  funcNodes: LocatedNode[],
): SgNode | null {
  const { line_start, line_end } = entity.location;

  // 1) Exact start-line match
  for (const fn of funcNodes) {
    if (fn.lineStart === line_start) {
      return fn.node;
    }
  }

  // 2) Entity range contains the function node (arrow functions in declarations)
  for (const fn of funcNodes) {
    if (fn.lineStart >= line_start && fn.lineEnd <= line_end) {
      return fn.node;
    }
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Populate metrics on entities by finding their corresponding AST nodes.
 * Modifies entities in-place.
 *
 * - function/method entities get: cognitive_complexity, cyclomatic_complexity,
 *   halstead_volume, halstead_difficulty, halstead_bugs, quality_score, line_count
 * - class/interface/enum/namespace entities get: line_count, quality_score
 * - file entities already have line_count from the parser
 */
export function populateEntityMetrics(
  root: SgNode,
  entities: Entity[],
  options: PopulateMetricsOptions = {},
): void {
  const hasFunctions = entities.some((e) => e.kind === 'function' || e.kind === 'method');
  const funcNodes = hasFunctions ? findFunctionNodes(root) : [];
  const cognitive = options.cognitive ?? true;

  for (const entity of entities) {
    ensureLineCount(entity);

    if (entity.kind === 'function' || entity.kind === 'method') {
      populateFunctionMetrics(entity, funcNodes, cognitive);
    } else if (isContainerKind(entity.kind)) {
      entity.metrics!.quality_score = computeQualityScore(entity.metrics!);
    }
    // file, variable, parameter, field, etc. keep only line_count
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureLineCount(entity: Entity): void {
  if (!entity.metrics) {
    entity.metrics = {
      line_count: entity.location.line_end - entity.location.line_start + 1,
    };
  }
  if (entity.metrics.line_count === undefined || entity.metrics.line_count === 0) {
    entity.metrics.line_count =
      entity.location.line_end - entity.location.line_start + 1;
  }
}

function isContainerKind(kind: string): boolean {
  return kind === 'class' || kind === 'interface' || kind === 'enum' || kind === 'namespace';
}

function populateFunctionMetrics(
  entity: Entity,
  funcNodes: LocatedNode[],
  cognitive: boolean,
): void {
  const astNode = matchEntityToNode(entity, funcNodes);

  if (astNode) {
    const metrics = entity.metrics as EntityMetrics;
    const cc = cognitive ? computeCognitiveComplexity(astNode, entity.language) : undefined;
    if (cc === undefined) delete metrics.cognitive_complexity;
    else metrics.cognitive_complexity = cc;
    metrics.cyclomatic_complexity = computeCyclomaticComplexity(astNode);

    const halstead = computeHalstead(astNode);
    metrics.halstead_volume = halstead.volume;
    metrics.halstead_difficulty = halstead.difficulty;
    metrics.halstead_bugs = halstead.bugs;
  }

  entity.metrics!.quality_score = computeQualityScore(entity.metrics!);
}
