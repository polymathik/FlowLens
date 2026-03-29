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
// Use Relations
// ────────────────────────────────────────────────────────────────

describe('use relations', () => {
  it('fires for variable read inside a function', () => {
    const { entities, relations } = parseAndExtract(`
      const config = { port: 3000 };
      function process() { console.log(config); }
    `);
    const uses = filterByType(relations, 'use');
    expect(uses.length).toBeGreaterThanOrEqual(1);

    const processEntity = entities.find(e => e.name === 'process');
    const configEntity = entities.find(e => e.name === 'config');
    expect(processEntity).toBeDefined();
    expect(configEntity).toBeDefined();

    const configUse = uses.find(u => u.to === configEntity!.id);
    expect(configUse).toBeDefined();
    expect(configUse!.from).toBe(processEntity!.id);
  });

  it('must NOT fire for function calls (only reads)', () => {
    const { relations } = parseAndExtract(`
      function helper() {}
      function main() { helper(); }
    `);
    const uses = filterByType(relations, 'use');
    // helper is a function entity, not a variable — should not create use
    expect(uses).toHaveLength(0);
  });

  it('does NOT fire for declarations (only references)', () => {
    const { relations } = parseAndExtract(`
      const x = 42;
    `);
    // x is a declaration, not a use — and there's no function to read it
    const uses = filterByType(relations, 'use');
    expect(uses).toHaveLength(0);
  });

  it('deduplicates multiple references to the same variable in one function', () => {
    const { relations } = parseAndExtract(`
      const config = { port: 3000 };
      function process() {
        console.log(config);
        console.log(config);
      }
    `);
    const uses = filterByType(relations, 'use');
    // Should deduplicate to just one use relation from process -> config
    const configUses = uses.filter(u => {
      return true; // all should be config since it's the only variable entity
    });
    expect(configUses).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Contain Relations
// ────────────────────────────────────────────────────────────────

describe('contain relations', () => {
  it('fires for class -> field', () => {
    const { entities, relations } = parseAndExtract(`
      class User {
        name: string = '';
        age: number = 0;
      }
    `);
    const contains = filterByType(relations, 'contain');
    expect(contains).toHaveLength(2);

    const userEntity = entities.find(e => e.name === 'User' && e.kind === 'class');
    expect(userEntity).toBeDefined();
    expect(contains.every(c => c.from === userEntity!.id)).toBe(true);
  });

  it('fires for class -> method', () => {
    const { entities, relations } = parseAndExtract(`
      class Service {
        process() {}
        validate() {}
      }
    `);
    const contains = filterByType(relations, 'contain');
    expect(contains).toHaveLength(2);

    const serviceEntity = entities.find(e => e.name === 'Service' && e.kind === 'class');
    expect(serviceEntity).toBeDefined();
    expect(contains.every(c => c.from === serviceEntity!.id)).toBe(true);
  });

  it('must NOT fire for local variables inside methods', () => {
    const { relations } = parseAndExtract(`
      class Service {
        process() {
          const localVar = 42;
        }
      }
    `);
    const contains = filterByType(relations, 'contain');
    // Should only contain the method, not the local variable
    const methodContains = contains.filter(c => {
      return true;
    });
    expect(methodContains).toHaveLength(1); // Just process()
  });

  it('fires for enum -> enum_member', () => {
    const { entities, relations } = parseAndExtract(`
      enum Color { Red, Green, Blue }
    `);
    const contains = filterByType(relations, 'contain');
    expect(contains).toHaveLength(3);

    const enumEntity = entities.find(e => e.name === 'Color' && e.kind === 'enum');
    expect(enumEntity).toBeDefined();
    expect(contains.every(c => c.from === enumEntity!.id)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Create Relations
// ────────────────────────────────────────────────────────────────

describe('create relations', () => {
  it('fires for new X() when X is a known class', () => {
    const { entities, relations } = parseAndExtract(`
      class User {}
      function createUser() { return new User(); }
    `);
    const creates = filterByType(relations, 'create');
    expect(creates).toHaveLength(1);

    const createUserEntity = entities.find(e => e.name === 'createUser');
    const userEntity = entities.find(e => e.name === 'User');
    expect(createUserEntity).toBeDefined();
    expect(userEntity).toBeDefined();
    expect(creates[0].from).toBe(createUserEntity!.id);
    expect(creates[0].to).toBe(userEntity!.id);
  });

  it('must NOT fire for regular function calls (only new)', () => {
    const { relations } = parseAndExtract(`
      class User {}
      function createUser() { return User(); }
    `);
    const creates = filterByType(relations, 'create');
    expect(creates).toHaveLength(0);
  });

  it('does NOT fire for new with unknown class', () => {
    const { relations } = parseAndExtract(`
      function createUser() { return new UnknownClass(); }
    `);
    const creates = filterByType(relations, 'create');
    expect(creates).toHaveLength(0);
  });

  it('fires for new inside a method', () => {
    const { relations } = parseAndExtract(`
      class Config {}
      class Service {
        init() { const c = new Config(); }
      }
    `);
    const creates = filterByType(relations, 'create');
    expect(creates).toHaveLength(1);
  });

  it('does NOT duplicate with throw relation (new inside throw)', () => {
    const { relations } = parseAndExtract(`
      class AppError {}
      function validate() { throw new AppError(); }
    `);
    const creates = filterByType(relations, 'create');
    const throws = filterByType(relations, 'throw');
    // new inside throw should produce throw, not create
    expect(creates).toHaveLength(0);
    expect(throws).toHaveLength(1);
  });
});
