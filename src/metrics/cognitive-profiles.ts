/**
 * Per-language node-kind tables for cognitive complexity. A language without
 * a profile gets `cognitive_complexity: undefined` (absent), never 0.
 * Profiles are verified by tests in test/unit/metrics/cognitive-complexity*.
 */
export interface CognitiveProfile {
  /** Function body node kinds. */
  body: Set<string>;
  ifKind: string;
  /** else / elif nodes that hang off an if statement. */
  elseKinds: Set<string>;
  /** The else node that may wrap an `else if` (TS `else_clause`). */
  elseClauseKind: string | null;
  /** +1 + nesting, increases nesting. */
  flowBreak: Set<string>;
  /** Increase nesting only (lambdas, nested functions). */
  nestingOnly: Set<string>;
  /** Node kinds that may be logical expressions, and their operator tokens. */
  logicalKinds: Set<string>;
  logicalOps: Set<string>;
}

const TS: CognitiveProfile = {
  body: new Set(['statement_block']),
  ifKind: 'if_statement',
  elseKinds: new Set(['else_clause']),
  elseClauseKind: 'else_clause',
  flowBreak: new Set([
    'switch_statement', 'for_statement', 'for_in_statement', 'while_statement',
    'do_statement', 'catch_clause', 'ternary_expression',
  ]),
  nestingOnly: new Set([
    'arrow_function', 'function_expression', 'function_declaration',
    'generator_function_declaration', 'generator_function', 'class_declaration',
  ]),
  logicalKinds: new Set(['binary_expression']),
  logicalOps: new Set(['&&', '||', '??']),
};

const PYTHON: CognitiveProfile = {
  body: new Set(['block']),
  ifKind: 'if_statement',
  elseKinds: new Set(['elif_clause', 'else_clause']),
  elseClauseKind: null,
  flowBreak: new Set([
    'for_statement', 'while_statement', 'except_clause', 'conditional_expression',
    'match_statement', 'list_comprehension_if',
  ]),
  nestingOnly: new Set(['lambda', 'function_definition', 'class_definition']),
  logicalKinds: new Set(['boolean_operator']),
  logicalOps: new Set(['and', 'or']),
};

const JAVA: CognitiveProfile = {
  body: new Set(['block', 'constructor_body']),
  ifKind: 'if_statement',
  elseKinds: new Set(),
  elseClauseKind: null,
  flowBreak: new Set([
    'switch_expression', 'switch_statement', 'for_statement', 'enhanced_for_statement',
    'while_statement', 'do_statement', 'catch_clause', 'ternary_expression',
  ]),
  nestingOnly: new Set(['lambda_expression', 'class_body']),
  logicalKinds: new Set(['binary_expression']),
  logicalOps: new Set(['&&', '||']),
};

const GO: CognitiveProfile = {
  body: new Set(['block']),
  ifKind: 'if_statement',
  elseKinds: new Set(),
  elseClauseKind: null,
  flowBreak: new Set([
    'for_statement', 'expression_switch_statement', 'type_switch_statement', 'select_statement',
  ]),
  nestingOnly: new Set(['func_literal']),
  logicalKinds: new Set(['binary_expression']),
  logicalOps: new Set(['&&', '||']),
};

export const PROFILES: Record<string, CognitiveProfile> = {
  typescript: TS,
  tsx: TS,
  javascript: TS,
  jsx: TS,
  python: PYTHON,
  java: JAVA,
  go: GO,
};
