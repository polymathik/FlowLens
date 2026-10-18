/**
 * Iterative AST traversal helpers.
 *
 * Every whole-tree walk in the parser and metrics goes through these so
 * that pathologically deep input (e.g. 10k nested array literals) cannot
 * overflow the JS call stack. Order is pre-order, children left to right.
 */
import type { SgNode } from '@ast-grep/napi';

/**
 * Visit `root` and all descendants in pre-order. Returning `false` from the
 * callback skips that node's children.
 */
export function walkNodes(root: SgNode, callback: (node: SgNode) => boolean | void): void {
  const stack: SgNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (callback(node) === false) continue;
    const children = node.children();
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

/**
 * Pre-order walk carrying a context value. The callback returns the context
 * for the node's children, or `null` to skip them.
 */
export function walkWithContext<C>(
  root: SgNode,
  initial: C,
  visit: (node: SgNode, ctx: C) => C | null,
): void {
  const stack: Array<[SgNode, C]> = [[root, initial]];
  while (stack.length > 0) {
    const [node, ctx] = stack.pop()!;
    const childCtx = visit(node, ctx);
    if (childCtx === null) continue;
    const children = node.children();
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], childCtx]);
  }
}

/** First descendant (pre-order, excluding `root`) whose kind matches. */
export function findDescendant(root: SgNode, kind: string): SgNode | null {
  let found: SgNode | null = null;
  walkNodes(root, (n) => {
    if (found) return false;
    if (n !== root && n.kind() === kind) {
      found = n;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Tree-sitter ERROR nodes (syntax errors), found natively by ast-grep so no
 * extra JS-side tree walk is needed. Returns 1-based start lines.
 */
export function findSyntaxErrorLines(root: SgNode): number[] {
  return root.findAll({ rule: { kind: 'ERROR' } }).map((n) => n.range().start.line + 1);
}
