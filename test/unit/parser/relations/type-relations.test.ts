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
// Parameter Relations
// ────────────────────────────────────────────────────────────────

describe('parameter relations', () => {
  it('fires for typed params referencing a known entity', () => {
    const { entities, relations } = parseAndExtract(`
      class User {}
      function save(user: User): void {}
    `);
    const params = filterByType(relations, 'parameter');
    expect(params).toHaveLength(1);

    const saveEntity = entities.find(e => e.name === 'save');
    const userEntity = entities.find(e => e.name === 'User');
    expect(saveEntity).toBeDefined();
    expect(userEntity).toBeDefined();
    expect(params[0].from).toBe(saveEntity!.id);
    expect(params[0].to).toBe(userEntity!.id);
  });

  it('does NOT fire for untyped params', () => {
    const { relations } = parseAndExtract(`
      class User {}
      function save(user) {}
    `);
    const params = filterByType(relations, 'parameter');
    expect(params).toHaveLength(0);
  });

  it('does NOT fire for primitive type annotations', () => {
    const { relations } = parseAndExtract(`
      function save(name: string, age: number): void {}
    `);
    const params = filterByType(relations, 'parameter');
    expect(params).toHaveLength(0);
  });

  it('fires for multiple typed params in one function', () => {
    const { relations } = parseAndExtract(`
      class User {}
      interface Config {}
      function process(user: User, config: Config): void {}
    `);
    const params = filterByType(relations, 'parameter');
    expect(params).toHaveLength(2);
  });

  it('fires for method params referencing known entity', () => {
    const { relations } = parseAndExtract(`
      class User {}
      class Service {
        save(user: User): void {}
      }
    `);
    const params = filterByType(relations, 'parameter');
    expect(params).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Return Relations
// ────────────────────────────────────────────────────────────────

describe('return relations', () => {
  it('fires for typed return referencing a known entity', () => {
    const { entities, relations } = parseAndExtract(`
      class User {}
      function getUser(): User { return new User(); }
    `);
    const returns = filterByType(relations, 'return');
    expect(returns).toHaveLength(1);

    const getUserEntity = entities.find(e => e.name === 'getUser');
    const userEntity = entities.find(e => e.name === 'User');
    expect(getUserEntity).toBeDefined();
    expect(userEntity).toBeDefined();
    expect(returns[0].from).toBe(getUserEntity!.id);
    expect(returns[0].to).toBe(userEntity!.id);
  });

  it('does NOT fire for void return type', () => {
    const { relations } = parseAndExtract(`
      class User {}
      function doStuff(): void {}
    `);
    const returns = filterByType(relations, 'return');
    expect(returns).toHaveLength(0);
  });

  it('does NOT fire for untyped return', () => {
    const { relations } = parseAndExtract(`
      class User {}
      function getUser() { return new User(); }
    `);
    const returns = filterByType(relations, 'return');
    expect(returns).toHaveLength(0);
  });

  it('fires for generic return type referencing known entity', () => {
    const { relations } = parseAndExtract(`
      class User {}
      function getUsers(): Promise<User> { return Promise.resolve(new User()); }
    `);
    const returns = filterByType(relations, 'return');
    // Should find User inside Promise<User>
    expect(returns.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Throw Relations
// ────────────────────────────────────────────────────────────────

describe('throw relations', () => {
  it('fires for throw new X()', () => {
    const { entities, relations } = parseAndExtract(`
      class ValidationError {}
      function validate() { throw new ValidationError(); }
    `);
    const throws = filterByType(relations, 'throw');
    expect(throws).toHaveLength(1);

    const validateEntity = entities.find(e => e.name === 'validate');
    const errorEntity = entities.find(e => e.name === 'ValidationError');
    expect(validateEntity).toBeDefined();
    expect(errorEntity).toBeDefined();
    expect(throws[0].from).toBe(validateEntity!.id);
    expect(throws[0].to).toBe(errorEntity!.id);
  });

  it('does NOT fire for throw "string"', () => {
    const { relations } = parseAndExtract(`
      function validate() { throw "error"; }
    `);
    const throws = filterByType(relations, 'throw');
    expect(throws).toHaveLength(0);
  });

  it('does NOT fire for throw variable', () => {
    const { relations } = parseAndExtract(`
      function validate() { const err = new Error(); throw err; }
    `);
    const throws = filterByType(relations, 'throw');
    expect(throws).toHaveLength(0);
  });

  it('fires for throw inside method', () => {
    const { relations } = parseAndExtract(`
      class AppError {}
      class Service {
        process() { throw new AppError(); }
      }
    `);
    const throws = filterByType(relations, 'throw');
    expect(throws).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Decorate Relations
// ────────────────────────────────────────────────────────────────

describe('decorate relations', () => {
  it('fires for @Decorator on class', () => {
    const { entities, relations } = parseAndExtract(`
      @Controller
      class ApiController {}
    `);
    const decorates = filterByType(relations, 'decorate');
    expect(decorates).toHaveLength(1);

    const classEntity = entities.find(e => e.name === 'ApiController' && e.kind === 'class');
    expect(classEntity).toBeDefined();
    expect(decorates[0].to).toBe(classEntity!.id);
  });

  it('fires for @Decorator() call expression on class', () => {
    const { entities, relations } = parseAndExtract(`
      @Controller('/api')
      class ApiController {}
    `);
    const decorates = filterByType(relations, 'decorate');
    expect(decorates).toHaveLength(1);

    const classEntity = entities.find(e => e.name === 'ApiController' && e.kind === 'class');
    expect(classEntity).toBeDefined();
    expect(decorates[0].to).toBe(classEntity!.id);
  });

  it('does NOT fire for non-decorator patterns', () => {
    const { relations } = parseAndExtract(`
      class Foo {}
      class Bar {}
    `);
    const decorates = filterByType(relations, 'decorate');
    expect(decorates).toHaveLength(0);
  });

  it('sets correct location for decorate relation', () => {
    const { relations } = parseAndExtract(`
      @Injectable
      class Service {}
    `);
    const decorates = filterByType(relations, 'decorate');
    expect(decorates).toHaveLength(1);
    expect(decorates[0].location.file).toBe('src/test.ts');
    expect(decorates[0].location.line).toBeGreaterThan(0);
  });
});
