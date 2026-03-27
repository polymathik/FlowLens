import { describe, it, expect } from 'vitest';
import { parse } from '@ast-grep/napi';
import { extractEntities } from '../../../src/parser/entity-extractor.js';
import { populateEntityMetrics } from '../../../src/metrics/compute-entity-metrics.js';

describe('populateEntityMetrics', () => {
  it('populates metrics on function entities', () => {
    const code = `function complex(a: boolean, b: boolean) {
      if (a) {
        if (b) {
          return 1;
        }
      }
      return 0;
    }`;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const fn = entities.find(e => e.kind === 'function' && e.name === 'complex');
    expect(fn).toBeDefined();
    expect(fn!.metrics?.cognitive_complexity).toBeGreaterThan(0);
    expect(fn!.metrics?.cyclomatic_complexity).toBeGreaterThan(1);
    expect(fn!.metrics?.halstead_volume).toBeGreaterThan(0);
    expect(fn!.metrics?.quality_score).toBeDefined();
    expect(fn!.metrics?.line_count).toBeGreaterThan(0);
  });

  it('populates line_count on class entities', () => {
    const code = `class Foo {
      bar() {}
      baz() {}
    }`;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const cls = entities.find(e => e.kind === 'class');
    expect(cls!.metrics?.line_count).toBeGreaterThan(0);
    expect(cls!.metrics?.quality_score).toBeDefined();
  });

  it('handles empty function', () => {
    const code = `function empty() {}`;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const fn = entities.find(e => e.kind === 'function');
    expect(fn!.metrics?.cognitive_complexity).toBe(0);
    expect(fn!.metrics?.cyclomatic_complexity).toBe(1);
  });

  it('populates metrics on method entities', () => {
    const code = `class Foo {
      bar(x: number) {
        if (x > 0) { return x; }
        return -x;
      }
    }`;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const method = entities.find(e => e.kind === 'method' && e.name === 'bar');
    expect(method).toBeDefined();
    expect(method!.metrics?.cognitive_complexity).toBeGreaterThan(0);
    expect(method!.metrics?.cyclomatic_complexity).toBeGreaterThan(1);
    expect(method!.metrics?.halstead_volume).toBeGreaterThan(0);
    expect(method!.metrics?.quality_score).toBeDefined();
  });

  it('quality score reflects complexity', () => {
    const simple = `function simple() { return 1; }`;
    const complex = `function complex(a: boolean) {
      if (a) { for (let i = 0; i < 10; i++) { if (i > 5) { console.log(i); } } }
    }`;

    const r1 = parse('TypeScript', simple).root();
    const e1 = extractEntities(r1, 'test.ts', 'typescript');
    populateEntityMetrics(r1, e1);

    const r2 = parse('TypeScript', complex).root();
    const e2 = extractEntities(r2, 'test.ts', 'typescript');
    populateEntityMetrics(r2, e2);

    const simpleFn = e1.find(e => e.kind === 'function')!;
    const complexFn = e2.find(e => e.kind === 'function')!;

    expect(simpleFn.metrics!.quality_score).toBeGreaterThan(
      complexFn.metrics!.quality_score!,
    );
  });

  it('populates metrics on arrow function variables', () => {
    const code = `const add = (a: number, b: number) => {
      if (a > 0) {
        return a + b;
      }
      return b;
    };`;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const fn = entities.find(e => e.kind === 'function' && e.name === 'add');
    expect(fn).toBeDefined();
    expect(fn!.metrics?.cognitive_complexity).toBeGreaterThan(0);
    expect(fn!.metrics?.cyclomatic_complexity).toBeGreaterThan(1);
    expect(fn!.metrics?.halstead_volume).toBeGreaterThan(0);
    expect(fn!.metrics?.quality_score).toBeDefined();
  });

  it('does not populate complexity metrics on non-function entities', () => {
    const code = `
      interface Greeter { greet(): string; }
      const x = 42;
      enum Color { Red, Green, Blue }
    `;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    const iface = entities.find(e => e.kind === 'interface');
    expect(iface!.metrics?.cognitive_complexity).toBeUndefined();
    expect(iface!.metrics?.quality_score).toBeDefined();

    const variable = entities.find(e => e.kind === 'variable');
    expect(variable!.metrics?.cognitive_complexity).toBeUndefined();
    expect(variable!.metrics?.quality_score).toBeUndefined();

    const enumEntity = entities.find(e => e.kind === 'enum');
    expect(enumEntity!.metrics?.quality_score).toBeDefined();
  });

  it('all entities have line_count after population', () => {
    const code = `
      class Foo {
        bar() { return 1; }
        baz: number = 0;
      }
      function standalone() {}
      const x = 10;
    `;
    const root = parse('TypeScript', code).root();
    const entities = extractEntities(root, 'test.ts', 'typescript');
    populateEntityMetrics(root, entities);

    for (const entity of entities) {
      expect(entity.metrics?.line_count).toBeGreaterThan(0);
    }
  });
});
