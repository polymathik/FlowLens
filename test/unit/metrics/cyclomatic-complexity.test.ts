import { describe, it, expect } from 'vitest';
import { computeCyclomaticComplexity } from '../../../src/metrics/cyclomatic-complexity.js';
import { parse } from '@ast-grep/napi';
import type { SgNode } from '@ast-grep/napi';

function findFunction(root: SgNode): SgNode {
  const fn = root.children().find(c =>
    c.kind() === 'function_declaration' || c.kind() === 'export_statement'
  );
  const target = fn?.kind() === 'export_statement'
    ? fn.children().find(c => c.kind() === 'function_declaration')
    : fn;
  if (!target) throw new Error('No function found');
  return target;
}

function getCyclomatic(code: string): number {
  const root = parse('TypeScript', code).root();
  const fn = findFunction(root);
  return computeCyclomaticComplexity(fn);
}

describe('cyclomatic complexity', () => {
  it('returns 1 for empty function', () => {
    expect(getCyclomatic('function f() {}')).toBe(1);
  });

  it('returns 1 for linear function (no branches)', () => {
    expect(getCyclomatic('function f() { const x = 1; return x; }')).toBe(1);
  });

  it('returns 2 for single if', () => {
    expect(getCyclomatic('function f() { if (a) {} }')).toBe(2);
  });

  it('returns 3 for if/else if/else (else does not count)', () => {
    // if=+1, else if=+1, else=0  → 1 + 2 = 3
    expect(getCyclomatic('function f() { if (a) {} else if (b) {} else {} }')).toBe(3);
  });

  it('returns 2 for for loop', () => {
    expect(getCyclomatic('function f() { for (let i=0; i<10; i++) {} }')).toBe(2);
  });

  it('returns 2 for while loop', () => {
    expect(getCyclomatic('function f() { while (true) {} }')).toBe(2);
  });

  it('returns 2 for do-while loop', () => {
    expect(getCyclomatic('function f() { do {} while (true); }')).toBe(2);
  });

  it('returns 2 for for-of loop', () => {
    expect(getCyclomatic('function f() { for (const x of items) {} }')).toBe(2);
  });

  it('returns 2 for for-in loop', () => {
    expect(getCyclomatic('function f() { for (const k in obj) {} }')).toBe(2);
  });

  it('returns 4 for switch with 3 cases (switch itself does not count)', () => {
    // 1 (base) + 3 cases = 4
    expect(getCyclomatic(
      'function f() { switch(x) { case 1: break; case 2: break; case 3: break; default: break; } }'
    )).toBe(4);
  });

  it('returns 2 for catch clause', () => {
    expect(getCyclomatic('function f() { try {} catch(e) {} }')).toBe(2);
  });

  it('does not count finally', () => {
    expect(getCyclomatic('function f() { try {} finally {} }')).toBe(1);
  });

  it('returns 3 for if with && operator', () => {
    // if=+1, &&=+1 → 1 + 2 = 3
    expect(getCyclomatic('function f() { if (a && b) {} }')).toBe(3);
  });

  it('counts || operator', () => {
    // if=+1, ||=+1 → 3
    expect(getCyclomatic('function f() { if (a || b) {} }')).toBe(3);
  });

  it('counts ?? operator', () => {
    // ??=+1 → 2
    expect(getCyclomatic('function f() { const x = a ?? b; }')).toBe(2);
  });

  it('returns 2 for ternary expression', () => {
    expect(getCyclomatic('function f() { const x = a ? 1 : 2; }')).toBe(2);
  });

  it('handles complex function: if + for + if && → 5', () => {
    // 1 (base) + if=1 + for=1 + if=1 + &&=1 = 5
    const code = `function f() {
      if (a) {
        for (const x of items) {
          if (x && y) {}
        }
      }
    }`;
    expect(getCyclomatic(code)).toBe(5);
  });

  it('handles multiple logical operators', () => {
    // if=+1, &&=+1, ||=+1 → 1+3=4
    expect(getCyclomatic('function f() { if (a && b || c) {} }')).toBe(4);
  });
});
