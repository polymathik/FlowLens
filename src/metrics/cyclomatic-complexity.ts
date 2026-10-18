import type { SgNode } from '@ast-grep/napi';
import { walkNodes } from '../parser/ast-walk.js';

/**
 * Node kinds that each contribute +1 decision point to cyclomatic complexity.
 * Covers all control flow forks per McCabe's definition.
 *
 * Note: `else_clause` is NOT included — plain `else` does not fork the graph.
 * `switch_default` is NOT included — only `switch_case` entries are decision points.
 * `switch_statement` itself is NOT included — complexity comes from its cases.
 */
const DECISION_KINDS = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement', // covers both for-in and for-of in tree-sitter
  'while_statement',
  'do_statement',
  'switch_case',
  'catch_clause',
  'ternary_expression',
]);

/**
 * Binary operator token kinds that each add +1 decision point.
 * These appear as direct children of binary_expression nodes.
 */
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

/**
 * Compute McCabe's cyclomatic complexity for a function/method AST node.
 *
 * Formula: M = 1 + decision_points
 *
 * Decision points: if, else if, loop headers, switch cases, catch, ternary,
 * and boolean short-circuit operators (&&, ||, ??).
 *
 * @param node - The function/method node (function_declaration, method_definition, etc.)
 * @returns Cyclomatic complexity score (minimum 1)
 */
export function computeCyclomaticComplexity(node: SgNode): number {
  return 1 + countDecisionPoints(node);
}

/**
 * Recursively count all decision points in the subtree rooted at `node`.
 */
function countDecisionPoints(root: SgNode): number {
  let count = 0;
  walkNodes(root, (node) => {
    const kind = String(node.kind());
    if (DECISION_KINDS.has(kind)) count += 1;
    if (kind === 'binary_expression') count += countLogicalOperator(node);
  });
  return count;
}

/**
 * Return 1 if this binary_expression uses a logical operator (&&, ||, ??),
 * otherwise 0. Does not recurse — recursion is handled by countDecisionPoints.
 */
function countLogicalOperator(node: SgNode): number {
  for (const child of node.children()) {
    if (LOGICAL_OPERATORS.has(String(child.kind()))) {
      return 1;
    }
  }
  return 0;
}
