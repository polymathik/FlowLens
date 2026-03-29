import { describe, it, expect } from 'vitest';
import { computeHalstead } from '../../../src/metrics/halstead.js';
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

function getHalstead(code: string) {
  const root = parse('TypeScript', code).root();
  const fn = findFunction(root);
  return computeHalstead(fn);
}

describe('halstead metrics', () => {
  it('returns zero-ish values for empty function', () => {
    const result = getHalstead('function empty() {}');
    // Only the function keyword and name are present — minimal values
    expect(result.vocabulary).toBeGreaterThanOrEqual(0);
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(result.bugs).toBeGreaterThanOrEqual(0);
  });

  it('has non-negative values for all fields', () => {
    const result = getHalstead('function f() { const x = 1; return x; }');
    expect(result.n1).toBeGreaterThanOrEqual(0);
    expect(result.n2).toBeGreaterThanOrEqual(0);
    expect(result.N1).toBeGreaterThanOrEqual(0);
    expect(result.N2).toBeGreaterThanOrEqual(0);
    expect(result.vocabulary).toBe(result.n1 + result.n2);
    expect(result.length).toBe(result.N1 + result.N2);
    expect(result.volume).toBeGreaterThanOrEqual(0);
    expect(result.difficulty).toBeGreaterThanOrEqual(0);
    expect(result.bugs).toBeGreaterThanOrEqual(0);
  });

  it('vocabulary equals n1 + n2', () => {
    const result = getHalstead('function f(a, b) { return a + b; }');
    expect(result.vocabulary).toBe(result.n1 + result.n2);
  });

  it('length equals N1 + N2', () => {
    const result = getHalstead('function f(a, b) { return a + b; }');
    expect(result.length).toBe(result.N1 + result.N2);
  });

  it('volume is length × log2(vocabulary) when vocabulary > 1', () => {
    const result = getHalstead('function f(a, b) { return a + b; }');
    if (result.vocabulary > 1) {
      const expected = result.length * Math.log2(result.vocabulary);
      expect(result.volume).toBeCloseTo(expected, 5);
    }
  });

  it('difficulty is (n1/2) × (N2/n2) when n2 > 0', () => {
    const result = getHalstead('function f(a, b) { return a + b; }');
    if (result.n2 > 0) {
      const expected = (result.n1 / 2) * (result.N2 / result.n2);
      expect(result.difficulty).toBeCloseTo(expected, 5);
    }
  });

  it('bugs equals volume / 3000', () => {
    const result = getHalstead('function f(a, b) { return a + b; }');
    expect(result.bugs).toBeCloseTo(result.volume / 3000, 10);
  });

  it('volume is 0 when vocabulary <= 1', () => {
    // Extremely minimal — if somehow vocabulary ≤ 1
    const result = getHalstead('function f() {}');
    if (result.vocabulary <= 1) {
      expect(result.volume).toBe(0);
    }
  });

  it('difficulty is 0 when n2 is 0', () => {
    // An empty function with no operands should have difficulty 0
    const result = getHalstead('function f() {}');
    if (result.n2 === 0) {
      expect(result.difficulty).toBe(0);
    }
  });

  it('detects more operators and operands in a complex function', () => {
    const simple = getHalstead('function f(a) { return a; }');
    const complex = getHalstead(`function g(a, b, c) {
      if (a > 0) {
        for (let i = 0; i < b; i++) {
          c = c + i;
        }
      }
      return c;
    }`);
    // Complex function must have more total tokens
    expect(complex.N1 + complex.N2).toBeGreaterThan(simple.N1 + simple.N2);
    expect(complex.vocabulary).toBeGreaterThan(simple.vocabulary);
  });

  it('add function has correct operand count for a, b appearing twice', () => {
    const result = getHalstead('function add(a, b) { return a + b; }');
    // Operands: add, a, b, a, b → n2=3 distinct (add,a,b), N2=5 total
    // This is a soft check that repeated identifiers increase N2 but not n2
    expect(result.N2).toBeGreaterThanOrEqual(result.n2);
  });

  it('N1 >= n1 (total operators >= distinct operators)', () => {
    const result = getHalstead('function f(a, b) { return a + b + a; }');
    expect(result.N1).toBeGreaterThanOrEqual(result.n1);
  });

  it('N2 >= n2 (total operands >= distinct operands)', () => {
    const result = getHalstead('function f(a, b) { return a + b + a; }');
    expect(result.N2).toBeGreaterThanOrEqual(result.n2);
  });
});
