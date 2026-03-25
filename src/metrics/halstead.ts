import type { SgNode } from '@ast-grep/napi';

/**
 * Result of Halstead metrics computation.
 */
export interface HalsteadResult {
  /** Distinct operators count */
  n1: number;
  /** Distinct operands count */
  n2: number;
  /** Total operators count */
  N1: number;
  /** Total operands count */
  N2: number;
  /** Vocabulary: n1 + n2 */
  vocabulary: number;
  /** Program length: N1 + N2 */
  length: number;
  /** Volume: length × log2(vocabulary), 0 when vocabulary ≤ 1 */
  volume: number;
  /** Difficulty: (n1/2) × (N2/n2), 0 when n2 = 0 */
  difficulty: number;
  /** Estimated bugs: volume / 3000 */
  bugs: number;
}

/**
 * Leaf node kinds classified as operators.
 *
 * Covers:
 * - Keyword control-flow operators
 * - Assignment and arithmetic/comparison punctuation
 * - Call `(`, indexing `[`, property `.`, optional chain `?.`, spread `...`
 * - Logical/nullish operators (also tracked by cognitive/cyclomatic metrics)
 */
const OPERATOR_KINDS = new Set([
  // Keywords
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'throw',
  'try', 'catch', 'finally',
  'new', 'delete', 'typeof', 'instanceof', 'void',
  'yield', 'await',
  'function',
  // Assignment and compound assignment
  '=', '+=', '-=', '*=', '/=', '%=', '**=',
  '&&=', '||=', '??=', '&=', '|=', '^=', '<<=', '>>=', '>>>=',
  // Arithmetic
  '+', '-', '*', '/', '%', '**',
  // Increment/decrement
  '++', '--',
  // Comparison
  '==', '!=', '===', '!==', '<', '<=', '>', '>=',
  // Logical / bitwise
  '&&', '||', '??', '!', '~', '&', '|', '^', '<<', '>>', '>>>',
  // Ternary
  '?', ':',
  // Property access / call / index
  '.', '(', '[',
  // Optional chain
  '?.',
  // Spread
  '...',
]);

/**
 * Leaf node kinds classified as operands.
 */
const OPERAND_KINDS = new Set([
  'identifier',
  'property_identifier',  // e.g. obj.bar — "bar" is an operand
  'string_fragment',
  'number',
  'true',
  'false',
  'null',
  'undefined',
  'regex_pattern',
]);

/**
 * Compute Halstead software science metrics for a function/method AST node.
 *
 * Walks all descendant nodes, classifying leaf tokens as operators or operands,
 * then derives vocabulary, length, volume, difficulty, and bug estimate.
 *
 * @param node - The function/method AST node
 * @returns HalsteadResult with all six derived metrics
 */
export function computeHalstead(node: SgNode): HalsteadResult {
  const distinctOperators = new Set<string>();
  const distinctOperands = new Set<string>();
  let N1 = 0;
  let N2 = 0;

  walkNode(node, distinctOperators, distinctOperands, (isOp) => {
    if (isOp) N1++;
    else N2++;
  });

  const n1 = distinctOperators.size;
  const n2 = distinctOperands.size;
  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const volume = vocabulary <= 1 ? 0 : length * Math.log2(vocabulary);
  const difficulty = n2 === 0 ? 0 : (n1 / 2) * (N2 / n2);
  const bugs = volume / 3000;

  return { n1, n2, N1, N2, vocabulary, length, volume, difficulty, bugs };
}

/**
 * Recursively walk every node in the subtree.
 * For leaf nodes (no children), classify and call `onToken`.
 */
function walkNode(
  node: SgNode,
  operators: Set<string>,
  operands: Set<string>,
  onToken: (isOperator: boolean) => void,
): void {
  const kind = node.kind();
  const children = node.children();

  if (children.length === 0) {
    // Leaf node — classify it
    if (OPERATOR_KINDS.has(kind)) {
      const text = node.text();
      operators.add(text);
      onToken(true);
    } else if (OPERAND_KINDS.has(kind)) {
      const text = node.text();
      operands.add(text);
      onToken(false);
    }
    return;
  }

  // Internal node — recurse into children
  for (const child of children) {
    walkNode(child, operators, operands, onToken);
  }
}
