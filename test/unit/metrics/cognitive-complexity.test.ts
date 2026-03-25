import { describe, it, expect } from 'vitest';
import { computeCognitiveComplexity } from '../../../src/metrics/cognitive-complexity.js';
import { parse } from '@ast-grep/napi';

function getComplexity(code: string): number {
  const root = parse('TypeScript', code).root();
  // Find the first function/method declaration
  const fn = root.children().find(c =>
    c.kind() === 'function_declaration' || c.kind() === 'export_statement'
  );
  // If export_statement, find the function inside
  const target = fn?.kind() === 'export_statement'
    ? fn.children().find(c => c.kind() === 'function_declaration')
    : fn;
  if (!target) throw new Error('No function found in: ' + code);
  return computeCognitiveComplexity(target);
}

describe('cognitive complexity', () => {
  it('returns 0 for empty function', () => {
    expect(getComplexity('function empty() {}')).toBe(0);
  });

  it('returns 0 for linear function', () => {
    expect(getComplexity('function linear() { const x = 1; return x; }')).toBe(0);
  });

  it('returns 1 for single if', () => {
    expect(getComplexity('function f() { if (true) {} }')).toBe(1);
  });

  it('returns 2 for if/else', () => {
    expect(getComplexity('function f() { if (true) {} else {} }')).toBe(2);
  });

  it('returns 3 for if/else-if/else', () => {
    expect(getComplexity('function f() { if (a) {} else if (b) {} else {} }')).toBe(3);
  });

  it('adds nesting depth to increment', () => {
    // if (+1) > if (+2, nesting=1) = 3
    expect(getComplexity('function f() { if (a) { if (b) {} } }')).toBe(3);
  });

  it('scores the spec reference example as 7', () => {
    const code = `function example(a: boolean, b: boolean, items: number[]) {
      if (a) {
        for (const item of items) {
          if (item > 0) {
            console.log(item);
          } else if (b) {
            console.log('b');
          }
        }
      }
    }`;
    expect(getComplexity(code)).toBe(7);
  });

  it('counts switch as +1', () => {
    expect(getComplexity('function f() { switch(x) { case 1: break; case 2: break; } }')).toBe(1);
  });

  it('counts for loop', () => {
    expect(getComplexity('function f() { for (let i=0; i<10; i++) {} }')).toBe(1);
  });

  it('counts while loop', () => {
    expect(getComplexity('function f() { while (true) {} }')).toBe(1);
  });

  it('counts catch', () => {
    expect(getComplexity('function f() { try {} catch(e) {} }')).toBe(1);
  });

  it('does not count finally', () => {
    expect(getComplexity('function f() { try {} finally {} }')).toBe(0);
  });

  it('counts logical operators &&', () => {
    expect(getComplexity('function f() { if (a && b) {} }')).toBe(2);
  });

  it('counts logical operators ||', () => {
    expect(getComplexity('function f() { if (a || b) {} }')).toBe(2);
  });

  it('counts ternary', () => {
    expect(getComplexity('function f() { const x = a ? 1 : 2; }')).toBe(1);
  });

  it('counts nested arrow function as nesting increase', () => {
    // Arrow function increases nesting depth
    // if inside arrow at nesting=1 -> +2
    expect(getComplexity('function f() { const g = () => { if (x) {} }; }')).toBe(2);
  });

  it('handles deeply nested code', () => {
    // if(+1) > for(+2) > if(+3) > while(+4) = 10
    const code = `function f() {
      if (a) {
        for (const x of items) {
          if (x) {
            while (true) { break; }
          }
        }
      }
    }`;
    expect(getComplexity(code)).toBe(10);
  });
});
