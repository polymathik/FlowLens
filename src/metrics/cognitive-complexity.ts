import type { SgNode } from '@ast-grep/napi';
import { PROFILES, type CognitiveProfile } from './cognitive-profiles.js';

/**
 * SonarSource-style cognitive complexity, iterative (no recursion, so
 * deeply nested input cannot overflow the stack) and language-aware.
 *
 * Rules implemented (per the Sonar white paper):
 *   - +1 + nesting for if / loops / switch / catch / ternary,
 *   - +1 (no nesting bonus) for `else`, `else if` / `elif`,
 *   - +1 per *sequence* of like boolean operators (`a && b && c` = 1,
 *     `a && b || c` = 2),
 *   - nested functions / lambdas increase nesting.
 *
 * @param language - profile key (typescript/tsx/javascript/jsx/python/java/go)
 * @returns the score, or undefined when the language has no verified profile
 */
export function computeCognitiveComplexity(node: SgNode, language = 'typescript'): number | undefined {
  const profile = PROFILES[language];
  if (!profile) return undefined;
  const body = node.children().find((c) => profile.body.has(String(c.kind())));
  if (!body) return 0;
  return score(body, profile);
}

interface Frame {
  node: SgNode;
  nesting: number;
  /** Logical operator of the parent node, when it is a logical expression. */
  parentOp: string | null;
  /** This if_statement is the `if` of an `else if` (no own increment). */
  elseIf?: boolean;
}

function score(body: SgNode, p: CognitiveProfile): number {
  let total = 0;
  const stack: Frame[] = [];
  const pushChildren = (n: SgNode, nesting: number, parentOp: string | null = null) => {
    const kids = n.children();
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], nesting, parentOp });
  };
  pushChildren(body, 0);

  while (stack.length > 0) {
    const { node, nesting, parentOp, elseIf } = stack.pop()!;
    const kind = String(node.kind());

    if (kind === p.ifKind) {
      if (!elseIf) total += 1 + nesting;
      pushIfChildren(node, nesting, p, stack, () => { total += 1; });
      continue;
    }
    if (p.elseKinds.has(kind)) {
      // Python elif/else (and TS else_clause reached outside an if — defensive)
      total += 1;
      const inner = node.children().find((c) => String(c.kind()) === p.ifKind);
      if (inner && kind === p.elseClauseKind) stack.push({ node: inner, nesting, parentOp: null, elseIf: true });
      else pushChildren(node, nesting + 1);
      continue;
    }
    if (p.flowBreak.has(kind)) {
      total += 1 + nesting;
      pushChildren(node, nesting + 1);
      continue;
    }
    if (p.nestingOnly.has(kind)) {
      pushChildren(node, nesting + 1);
      continue;
    }
    const op = logicalOperator(node, kind, p);
    if (op) {
      if (op !== parentOp) total += 1;
      pushChildren(node, nesting, op);
      continue;
    }
    pushChildren(node, nesting, kind === 'parenthesized_expression' ? parentOp : null);
  }
  return total;
}

/**
 * Children of an if statement: condition + consequence nested one level;
 * the else branch at the if's own level (+1, `else if` chains flatten).
 */
function pushIfChildren(
  node: SgNode, nesting: number, p: CognitiveProfile, stack: Frame[], onElse: () => void,
): void {
  const kids = node.children();
  const frames: Frame[] = [];
  let afterElseToken = false;
  for (const c of kids) {
    const k = String(c.kind());
    if (k === 'else') { afterElseToken = true; continue; }
    if (afterElseToken) {
      // Java / Go: `else` token followed by the alternative
      afterElseToken = false;
      onElse();
      if (k === p.ifKind) frames.push({ node: c, nesting, parentOp: null, elseIf: true });
      else frames.push({ node: c, nesting: nesting + 1, parentOp: null });
      continue;
    }
    if (p.elseKinds.has(k)) {
      frames.push({ node: c, nesting, parentOp: null });
      continue;
    }
    frames.push({ node: c, nesting: nesting + 1, parentOp: null });
  }
  for (let i = frames.length - 1; i >= 0; i--) stack.push(frames[i]);
}

function logicalOperator(node: SgNode, kind: string, p: CognitiveProfile): string | null {
  if (!p.logicalKinds.has(kind)) return null;
  for (const c of node.children()) {
    const k = String(c.kind());
    if (p.logicalOps.has(k)) return k;
  }
  return null;
}
