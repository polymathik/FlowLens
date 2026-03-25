import type { SgNode } from '@ast-grep/napi';

/**
 * Node kinds that cause a flow break (increment by 1 + nesting depth).
 */
const FLOW_BREAK_KINDS = new Set([
  'if_statement',
  'switch_statement',
  'for_statement',
  'for_in_statement', // covers both for-in and for-of in tree-sitter
  'while_statement',
  'do_statement',
  'catch_clause',
  'ternary_expression',
]);

/**
 * Node kinds that increase nesting depth for their children.
 */
const NESTING_KINDS = new Set([
  'if_statement',
  'switch_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'catch_clause',
  'arrow_function',
  'function_declaration',
  'function_expression',
  'method_definition',
  'generator_function_declaration',
]);

/**
 * Logical operators that add +1 each (no nesting).
 */
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

/**
 * Compute SonarQube-style cognitive complexity for a function/method AST node.
 *
 * @param node - The function/method node (function_declaration, method_definition, etc.)
 * @returns The cognitive complexity score (0 = trivial)
 */
export function computeCognitiveComplexity(node: SgNode): number {
  const body = findFunctionBody(node);
  if (!body) return 0;

  return walkComplexity(body, 0);
}

/**
 * Find the statement_block (body) of a function node.
 */
function findFunctionBody(node: SgNode): SgNode | null {
  for (const child of node.children()) {
    if (child.kind() === 'statement_block') {
      return child;
    }
  }
  return null;
}

/**
 * Recursively walk AST nodes, accumulating cognitive complexity.
 *
 * @param node - Current AST node
 * @param nesting - Current nesting depth
 * @returns Complexity score for this subtree
 */
function walkComplexity(node: SgNode, nesting: number): number {
  let score = 0;

  for (const child of node.children()) {
    score += scoreNode(child, nesting);
  }

  return score;
}

/**
 * Score a single node and recurse into its children.
 */
function scoreNode(node: SgNode, nesting: number): number {
  const kind = node.kind();
  let score = 0;

  // Handle else_clause specially
  if (kind === 'else_clause') {
    return scoreElseClause(node, nesting);
  }

  // Handle logical operators in binary expressions
  if (kind === 'binary_expression') {
    return scoreLogicalExpression(node, nesting);
  }

  // Flow-breaking constructs: +1 + nesting
  if (FLOW_BREAK_KINDS.has(kind)) {
    score += 1 + nesting;

    // Recurse into children with increased nesting if this kind nests
    const childNesting = NESTING_KINDS.has(kind) ? nesting + 1 : nesting;
    score += walkComplexity(node, childNesting);
    return score;
  }

  // Nesting-only constructs (nested functions/arrows that are not flow breaks)
  if (isNestedFunction(kind)) {
    const body = findFunctionBody(node);
    if (body) {
      score += walkComplexity(body, nesting + 1);
    }
    return score;
  }

  // Default: recurse into children at current nesting
  score += walkComplexity(node, nesting);
  return score;
}

/**
 * Score an else_clause. `else` gets +1 but does NOT increase nesting.
 * `else if` gets +1 for the else_clause, then the contained if_statement
 * is handled as a flow break but at the SAME nesting as the original if.
 */
function scoreElseClause(node: SgNode, nesting: number): number {
  let score = 0;
  const children = node.children();

  // Check if this is "else if" or plain "else"
  const hasNestedIf = children.some(c => c.kind() === 'if_statement');

  if (hasNestedIf) {
    // "else if" — the else_clause adds +1 for the "else if" as a single construct
    // The contained if_statement is processed at the current nesting level
    // but does NOT add its own flow-break increment (it's part of the else-if)
    for (const child of children) {
      if (child.kind() === 'if_statement') {
        // +1 for the "else if" itself (at current nesting, no nesting bonus)
        score += 1;
        // Process the if_statement's children at current nesting level
        // but skip the if_statement's own flow-break scoring
        score += walkElseIfBody(child, nesting);
      }
    }
  } else {
    // Plain "else" — +1, no nesting increase
    score += 1;
    // Process else body at current nesting (else doesn't increase nesting)
    for (const child of children) {
      if (child.kind() === 'statement_block') {
        score += walkComplexity(child, nesting);
      }
    }
  }

  return score;
}

/**
 * Walk the body of an "else if" — process its consequence and any further
 * else clauses, but don't count the if_statement itself as a flow break
 * (we already counted it as +1 in scoreElseClause).
 */
function walkElseIfBody(ifNode: SgNode, nesting: number): number {
  let score = 0;

  for (const child of ifNode.children()) {
    const kind = child.kind();
    if (kind === 'statement_block') {
      // The "then" branch of the else-if: process at nesting+1
      // because the if creates nesting for its contents
      score += walkComplexity(child, nesting + 1);
    } else if (kind === 'else_clause') {
      // Further else/else-if chains
      score += scoreElseClause(child, nesting);
    } else if (kind === 'parenthesized_expression') {
      // Check for logical operators in the condition
      score += walkComplexity(child, nesting);
    }
  }

  return score;
}

/**
 * Score logical operators in binary expressions.
 * Each distinct logical operator adds +1 (no nesting bonus).
 * Consecutive same-operator sequences are counted individually.
 */
function scoreLogicalExpression(node: SgNode, nesting: number): number {
  let score = 0;
  const children = node.children();

  // Find the operator token
  const operator = children.find(c => LOGICAL_OPERATORS.has(c.kind()));

  if (operator) {
    // This is a logical binary expression — add +1 for the operator
    score += 1;

    // Recurse into left and right operands to find nested logical ops
    for (const child of children) {
      if (child.kind() === 'binary_expression') {
        score += scoreLogicalExpression(child, nesting);
      } else {
        // Non-binary children (identifiers, etc.) — check for ternary etc.
        score += walkComplexity(child, nesting);
      }
    }
  } else {
    // Not a logical operator (e.g., arithmetic/comparison) — just recurse
    score += walkComplexity(node, nesting);
  }

  return score;
}

/**
 * Check if a node kind represents a nested function/arrow that increases nesting
 * but is not a flow-break construct.
 */
function isNestedFunction(kind: string): boolean {
  return (
    kind === 'arrow_function' ||
    kind === 'function_expression' ||
    kind === 'generator_function_declaration'
  );
}
