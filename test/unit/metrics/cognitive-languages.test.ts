/**
 * Cognitive complexity across languages (Phase 8): verified profiles for
 * TS/JS, Python, Java, Go; absent (undefined) for languages without one.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../src/parser/lang-registration.js';
import { computeCognitiveComplexity } from '../../../src/metrics/cognitive-complexity.js';
import { AstGrepParser } from '../../../src/parser/ast-grep-parser.js';

beforeAll(() => ensureLanguagesRegistered());

function fnNode(lang: string, code: string, kind: string) {
  return parse(lang, code).root().find({ rule: { kind } })!;
}

describe('boolean operator sequences', () => {
  it('a && b && c scores 1; a && b || c scores 2', () => {
    const one = fnNode('TypeScript', 'function f(a, b, c) { return a && b && c; }', 'function_declaration');
    const two = fnNode('TypeScript', 'function f(a, b, c) { return a && b || c; }', 'function_declaration');
    expect(computeCognitiveComplexity(one, 'typescript')).toBe(1);
    expect(computeCognitiveComplexity(two, 'typescript')).toBe(2);
  });
});

describe('Python', () => {
  it('scores if/elif/else, loops with nesting and boolean ops', () => {
    const code = [
      'def f(x, y):',
      '    if x and y and x:',      // +1 if, +1 and-sequence
      '        for i in x:',         // +2 (nesting 1)
      '            pass',
      '    elif y:',                 // +1
      '        pass',
      '    else:',                   // +1
      '        while x or y:',       // +2 (nesting 1), +1 or
      '            pass',
    ].join('\n');
    expect(computeCognitiveComplexity(fnNode('python', code, 'function_definition'), 'python')).toBe(9);
  });
});

describe('Java', () => {
  it('scores if/else-if/else, catch and nested loops', () => {
    const code = `class A { void f(int x) {
      if (x > 1) {            // +1
        for (int i = 0; i < x; i++) {}   // +2
      } else if (x < 0) {     // +1
      } else {}               // +1
      try {} catch (Exception e) { while (x > 0 && x < 9) {} }  // catch +1, while +2, && +1
    } }`;
    expect(computeCognitiveComplexity(fnNode('java', code, 'method_declaration'), 'java')).toBe(9);
  });
});

describe('Go', () => {
  it('scores if/else, for and switch with nesting', () => {
    const code = `package p
func f(x int) int {
  if x > 0 {          // +1
    for i := 0; i < x; i++ { // +2
      switch i {     // +3
      case 1:
      }
    }
  } else {            // +1
  }
  return 0
}`;
    expect(computeCognitiveComplexity(fnNode('go', code, 'function_declaration'), 'go')).toBe(7);
  });
});

describe('languages without a profile', () => {
  it('leaves cognitive_complexity undefined (not 0) for Rust', async () => {
    const parser = new AstGrepParser('');
    const r = await parser.parseFile('src/lib.rs', 'fn f(x: i32) -> i32 { if x > 0 { 1 } else { 2 } }\n');
    const fn = r.entities.find((e) => e.kind === 'function');
    expect(fn).toBeDefined();
    expect(fn!.metrics?.cognitive_complexity).toBeUndefined();
  });

  it('computes it for Python entities through the parser', async () => {
    const parser = new AstGrepParser('');
    const r = await parser.parseFile('a.py', 'def f(x):\n    if x:\n        return 1\n    return 0\n');
    expect(r.entities.find((e) => e.name === 'f')?.metrics?.cognitive_complexity).toBe(1);
  });
});
