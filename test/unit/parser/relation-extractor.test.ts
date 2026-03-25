import { describe, it, expect } from 'vitest';
import { extractRelations } from '../../../src/parser/relation-extractor.js';
import { extractEntities } from '../../../src/parser/entity-extractor.js';
import { parse } from '@ast-grep/napi';
import type { Relation } from '../../../src/contracts/relations.js';

/** Parse TS code and extract both entities and relations. */
function parseAndExtract(code: string, filePath = 'src/test.ts') {
  const root = parse('TypeScript', code).root();
  const entities = extractEntities(root, filePath, 'typescript');
  const relations = extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

/** Find first relation by type. */
function findByType(relations: Relation[], type: string): Relation | undefined {
  return relations.find(r => r.type === type);
}

/** Find all relations by type. */
function filterByType(relations: Relation[], type: string): Relation[] {
  return relations.filter(r => r.type === type);
}

// ────────────────────────────────────────────────────────────────
// 1. Import Relations
// ────────────────────────────────────────────────────────────────

describe('import relations', () => {
  // Note: import relations require resolveImportPath to find a real file.
  // Since we're parsing synthetic code with no filesystem, most import
  // relations won't resolve. We test the extraction logic by verifying
  // the extractor handles all import patterns without errors.

  it('does not create import relation when target file does not exist', () => {
    const { relations } = parseAndExtract(`import { Foo } from './foo';`);
    const imp = findByType(relations, 'import');
    // Path cannot be resolved without real filesystem => no relation
    expect(imp).toBeUndefined();
  });

  it('handles CJS require without crashing', () => {
    const { relations } = parseAndExtract(
      `const foo = require('./foo');`,
      'src/bar.js',
    );
    // Should not throw, relation won't resolve without filesystem
    expect(Array.isArray(relations)).toBe(true);
  });

  it('handles dynamic import without crashing', () => {
    const { relations } = parseAndExtract(`import('./dynamic');`);
    expect(Array.isArray(relations)).toBe(true);
  });

  it('handles re-export without crashing', () => {
    const { relations } = parseAndExtract(`export { Foo } from './foo';`);
    expect(Array.isArray(relations)).toBe(true);
  });

  it('handles namespace import without crashing', () => {
    const { relations } = parseAndExtract(`import * as Foo from './foo';`);
    expect(Array.isArray(relations)).toBe(true);
  });

  it('handles default import without crashing', () => {
    const { relations } = parseAndExtract(`import Foo from './foo';`);
    expect(Array.isArray(relations)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// 2. Call Relations
// ────────────────────────────────────────────────────────────────

describe('call relations', () => {
  it('extracts direct function calls within same file', () => {
    const { relations } = parseAndExtract(`
      function greet() { return 'hi'; }
      function main() { greet(); }
    `);
    const call = findByType(relations, 'call');
    expect(call).toBeDefined();
    expect(call!.confidence).toBe(1.0);
    expect(call!.weight).toBe(1);
  });

  it('from entity is the calling function, to entity is the callee', () => {
    const { entities, relations } = parseAndExtract(`
      function greet() { return 'hi'; }
      function main() { greet(); }
    `);
    const call = findByType(relations, 'call')!;
    const mainEntity = entities.find(e => e.name === 'main');
    const greetEntity = entities.find(e => e.name === 'greet');
    expect(mainEntity).toBeDefined();
    expect(greetEntity).toBeDefined();
    expect(call.from).toBe(mainEntity!.id);
    expect(call.to).toBe(greetEntity!.id);
  });

  it('extracts this.method() calls within a class', () => {
    const { relations } = parseAndExtract(`
      class Foo {
        bar() { return 1; }
        baz() { this.bar(); }
      }
    `);
    const call = findByType(relations, 'call');
    expect(call).toBeDefined();
  });

  it('this.method() from is calling method, to is called method', () => {
    const { entities, relations } = parseAndExtract(`
      class Foo {
        bar() { return 1; }
        baz() { this.bar(); }
      }
    `);
    const call = findByType(relations, 'call')!;
    const bazEntity = entities.find(e => e.name === 'baz');
    const barEntity = entities.find(e => e.name === 'bar');
    expect(bazEntity).toBeDefined();
    expect(barEntity).toBeDefined();
    expect(call.from).toBe(bazEntity!.id);
    expect(call.to).toBe(barEntity!.id);
  });

  it('does not create call relation for unknown functions', () => {
    const { relations } = parseAndExtract(`
      function main() { unknown(); }
    `);
    const call = findByType(relations, 'call');
    expect(call).toBeUndefined();
  });

  it('extracts multiple calls from one function', () => {
    const { relations } = parseAndExtract(`
      function a() {}
      function b() {}
      function main() { a(); b(); }
    `);
    const calls = filterByType(relations, 'call');
    expect(calls).toHaveLength(2);
  });

  it('sets correct location for call relations', () => {
    const { relations } = parseAndExtract(`
      function greet() { return 'hi'; }
      function main() { greet(); }
    `);
    const call = findByType(relations, 'call')!;
    expect(call.location.file).toBe('src/test.ts');
    expect(call.location.line).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. Extend Relations
// ────────────────────────────────────────────────────────────────

describe('extend relations', () => {
  it('extracts class inheritance', () => {
    const { relations } = parseAndExtract(`
      class Base {}
      class Child extends Base {}
    `);
    const ext = findByType(relations, 'extend');
    expect(ext).toBeDefined();
    expect(ext!.confidence).toBe(1.0);
  });

  it('from is child class, to is parent class', () => {
    const { entities, relations } = parseAndExtract(`
      class Base {}
      class Child extends Base {}
    `);
    const ext = findByType(relations, 'extend')!;
    const childEntity = entities.find(e => e.name === 'Child');
    const baseEntity = entities.find(e => e.name === 'Base');
    expect(childEntity).toBeDefined();
    expect(baseEntity).toBeDefined();
    expect(ext.from).toBe(childEntity!.id);
    expect(ext.to).toBe(baseEntity!.id);
  });

  it('does not create extend relation for unknown parent', () => {
    const { relations } = parseAndExtract(`
      class Child extends UnknownBase {}
    `);
    const ext = findByType(relations, 'extend');
    expect(ext).toBeUndefined();
  });

  it('sets correct location for extend relations', () => {
    const { relations } = parseAndExtract(`
      class Base {}
      class Child extends Base {}
    `);
    const ext = findByType(relations, 'extend')!;
    expect(ext.location.file).toBe('src/test.ts');
    expect(ext.location.line).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. Implement Relations
// ────────────────────────────────────────────────────────────────

describe('implement relations', () => {
  it('extracts interface implementation', () => {
    const { relations } = parseAndExtract(`
      interface IFoo { bar(): void; }
      class Foo implements IFoo { bar() {} }
    `);
    const impl = findByType(relations, 'implement');
    expect(impl).toBeDefined();
    expect(impl!.confidence).toBe(1.0);
  });

  it('from is implementing class, to is interface', () => {
    const { entities, relations } = parseAndExtract(`
      interface IFoo { bar(): void; }
      class Foo implements IFoo { bar() {} }
    `);
    const impl = findByType(relations, 'implement')!;
    const fooEntity = entities.find(e => e.name === 'Foo');
    const ifooEntity = entities.find(e => e.name === 'IFoo');
    expect(fooEntity).toBeDefined();
    expect(ifooEntity).toBeDefined();
    expect(impl.from).toBe(fooEntity!.id);
    expect(impl.to).toBe(ifooEntity!.id);
  });

  it('extracts multiple interface implementations', () => {
    const { relations } = parseAndExtract(`
      interface IA {}
      interface IB {}
      class Foo implements IA, IB {}
    `);
    const impls = filterByType(relations, 'implement');
    expect(impls).toHaveLength(2);
  });

  it('does not create implement relation for unknown interface', () => {
    const { relations } = parseAndExtract(`
      class Foo implements UnknownInterface {}
    `);
    const impl = findByType(relations, 'implement');
    expect(impl).toBeUndefined();
  });

  it('handles class with both extends and implements', () => {
    const { relations } = parseAndExtract(`
      class Base {}
      interface IFoo {}
      class Child extends Base implements IFoo {}
    `);
    const ext = findByType(relations, 'extend');
    const impl = findByType(relations, 'implement');
    expect(ext).toBeDefined();
    expect(impl).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────
// 5. Comprehensive Scenario
// ────────────────────────────────────────────────────────────────

describe('comprehensive scenario', () => {
  it('extracts all relation types from a complex file', () => {
    const { relations } = parseAndExtract(`
      interface IService { run(): void; }
      class Base { start() {} }
      class Service extends Base implements IService {
        run() { this.start(); }
      }
      function helper() {}
      function main() { helper(); }
    `);

    const extends_ = filterByType(relations, 'extend');
    const implements_ = filterByType(relations, 'implement');
    const calls = filterByType(relations, 'call');

    expect(extends_).toHaveLength(1);
    expect(implements_).toHaveLength(1);
    // this.start() won't resolve because start() is on Base, not Service
    // (cross-class resolution requires inheritance-aware analysis)
    expect(calls.length).toBeGreaterThanOrEqual(1); // helper()
  });

  it('all relations have valid ids', () => {
    const { relations } = parseAndExtract(`
      function a() {}
      function b() { a(); }
    `);
    for (const rel of relations) {
      expect(rel.id).toBeDefined();
      expect(rel.id).toHaveLength(16);
    }
  });

  it('all relations have valid location', () => {
    const { relations } = parseAndExtract(`
      function a() {}
      function b() { a(); }
    `);
    for (const rel of relations) {
      expect(rel.location.file).toBe('src/test.ts');
      expect(rel.location.line).toBeGreaterThan(0);
      expect(rel.location.column).toBeGreaterThanOrEqual(0);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// 6. Import Confidence Tiers (using real fixtures for path resolution)
// ────────────────────────────────────────────────────────────────

import { join } from 'node:path';

const FIXTURE_ROOT = join(import.meta.dirname, '../../fixtures/simple-project');

function parseWithFixtureRoot(code: string, filePath: string) {
  const root = parse('TypeScript', code).root();
  const entities = extractEntities(root, filePath, 'typescript');
  const relations = extractRelations(root, filePath, entities, FIXTURE_ROOT);
  return { entities, relations };
}

describe('import confidence tiers', () => {
  it('assigns 1.0 for static ESM import', () => {
    const { relations } = parseWithFixtureRoot(
      `import { UserService } from './user-service';`,
      'index.ts',
    );
    const imp = findByType(relations, 'import');
    expect(imp).toBeDefined();
    expect(imp!.confidence).toBe(1.0);
  });

  it('assigns 1.0 for require()', () => {
    const { relations } = parseWithFixtureRoot(
      `const utils = require('./utils');`,
      'index.ts',
    );
    const imp = findByType(relations, 'import');
    expect(imp).toBeDefined();
    expect(imp!.confidence).toBe(1.0);
  });

  it('assigns 1.0 for dynamic import with literal string', () => {
    const { relations } = parseWithFixtureRoot(
      `const m = import('./utils');`,
      'index.ts',
    );
    const imp = findByType(relations, 'import');
    expect(imp).toBeDefined();
    expect(imp!.confidence).toBe(1.0);
  });

  it('assigns 0.5 for dynamic import inside if statement', () => {
    const { relations } = parseWithFixtureRoot(
      `if (true) { import('./utils'); }`,
      'index.ts',
    );
    const imp = findByType(relations, 'import');
    expect(imp).toBeDefined();
    expect(imp!.confidence).toBe(0.5);
  });

  it('assigns 0.5 for dynamic import inside ternary', () => {
    const { relations } = parseWithFixtureRoot(
      `const m = true ? import('./utils') : null;`,
      'index.ts',
    );
    const imp = findByType(relations, 'import');
    expect(imp).toBeDefined();
    expect(imp!.confidence).toBe(0.5);
  });
});
