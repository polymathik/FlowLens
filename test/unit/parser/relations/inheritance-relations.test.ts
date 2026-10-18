import { describe, it, expect } from 'vitest';
import { extractRelations } from '../../../../src/parser/relation-extractor.js';
import { extractEntities } from '../../../../src/parser/entity-extractor.js';
import { parse } from '@ast-grep/napi';
import type { Relation } from '../../../../src/contracts/relations.js';

function parseAndExtract(code: string, filePath = 'src/test.ts') {
  const root = parse('TypeScript', code).root();
  const entities = extractEntities(root, filePath, 'typescript');
  const relations = extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function filterByType(relations: Relation[], type: string): Relation[] {
  return relations.filter(r => r.type === type);
}

// ────────────────────────────────────────────────────────────────
// Override Relations
// ────────────────────────────────────────────────────────────────

describe('override relations', () => {
  it('detects override when child method matches parent method name', () => {
    const { entities, relations } = parseAndExtract(`
      class Parent {
        greet() { return 'hello'; }
      }
      class Child extends Parent {
        greet() { return 'hi'; }
      }
    `);
    const overrides = filterByType(relations, 'override');
    expect(overrides).toHaveLength(1);

    const childGreet = entities.find(e => e.name === 'greet' && e.qualified_name.includes('Child'));
    const parentGreet = entities.find(e => e.name === 'greet' && e.qualified_name.includes('Parent'));
    expect(childGreet).toBeDefined();
    expect(parentGreet).toBeDefined();
    expect(overrides[0].from).toBe(childGreet!.id);
    expect(overrides[0].to).toBe(parentGreet!.id);
  });

  it('does NOT create override when methods have different names', () => {
    const { relations } = parseAndExtract(`
      class Parent {
        greet() { return 'hello'; }
      }
      class Child extends Parent {
        farewell() { return 'bye'; }
      }
    `);
    const overrides = filterByType(relations, 'override');
    expect(overrides).toHaveLength(0);
  });

  it('detects multiple overrides in same class', () => {
    const { relations } = parseAndExtract(`
      class Base {
        foo() {}
        bar() {}
      }
      class Derived extends Base {
        foo() {}
        bar() {}
      }
    `);
    const overrides = filterByType(relations, 'override');
    expect(overrides).toHaveLength(2);
  });

  it('does NOT detect override when parent is in different file (unknown)', () => {
    const { relations } = parseAndExtract(`
      class Child extends ExternalBase {
        greet() { return 'hi'; }
      }
    `);
    const overrides = filterByType(relations, 'override');
    expect(overrides).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────
// Mixin Relations
// ────────────────────────────────────────────────────────────────

describe('mixin relations', () => {
  it('detects mixin when extends clause contains a function call', () => {
    const { relations } = parseAndExtract(`
      function Timestamped(Base: any) { return Base; }
      class User extends Timestamped(Object) {}
    `);
    const mixins = filterByType(relations, 'mixin');
    expect(mixins).toHaveLength(1);
    expect(mixins[0].confidence).toBe(1.0);
  });

  it('mixin from is the class, to is the mixin function entity', () => {
    const { entities, relations } = parseAndExtract(`
      function Timestamped(Base: any) { return Base; }
      class User extends Timestamped(Object) {}
    `);
    const mixin = filterByType(relations, 'mixin')[0];
    const userEntity = entities.find(e => e.name === 'User');
    const tsEntity = entities.find(e => e.name === 'Timestamped');
    expect(userEntity).toBeDefined();
    expect(tsEntity).toBeDefined();
    expect(mixin.from).toBe(userEntity!.id);
    expect(mixin.to).toBe(tsEntity!.id);
  });

  it('does NOT create mixin for simple extends Identifier', () => {
    const { relations } = parseAndExtract(`
      class Base {}
      class Child extends Base {}
    `);
    const mixins = filterByType(relations, 'mixin');
    expect(mixins).toHaveLength(0);
  });

  // Phase 8: unbound mixins used to get a fabricated `unresolved:<name>` target id.
  // Now an unbound (global/unknown) mixin produces no edge, and an imported one
  // produces a pending relation resolved by pass 2 — never a fake id.
  it('does not fabricate a target id for an unbound mixin function', () => {
    const { relations } = parseAndExtract(`
      class User extends UnknownMixin(Object) {}
    `);
    const mixins = filterByType(relations, 'mixin');
    expect(mixins).toHaveLength(0);
  });

  it('emits a pending mixin relation for an imported mixin function', () => {
    const { relations } = parseAndExtract(`
      import { Timestamped } from './mixins';
      class User extends Timestamped(Object) {}
    `);
    const mixins = filterByType(relations, 'mixin');
    expect(mixins).toHaveLength(1);
    expect(mixins[0].to).toBe('');
    expect(mixins[0].target_name).toBe('Timestamped');
    expect(mixins[0].resolution).toBe('unresolved');
  });
});
