import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { cppExtractor } from '../../../../src/parser/extractors/cpp-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.cpp';

function extractEntities(code: string, filePath = FP): Entity[] {
  return cppExtractor.extractEntities(parse('cpp', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('cpp', code).root();
  const entities = cppExtractor.extractEntities(root, filePath);
  const relations = cppExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('C++ extractor — entities', () => {
  it('extracts classes', () => {
    const entities = extractEntities(`class Animal {
public:
  virtual void speak() = 0;
};
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Animal');
  });

  it('extracts namespaces', () => {
    const entities = extractEntities(`namespace utils {
  class Helper {};
}
`);
    const ns = findByKind(entities, 'namespace');
    expect(ns).toHaveLength(1);
    expect(ns[0].name).toBe('utils');

    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Helper');
  });

  it('extracts methods inside class', () => {
    const entities = extractEntities(`class Dog {
public:
  void bark() {}
private:
  void secret() {}
};
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('bark');
    expect(methods[0].visibility).toBe('public');
    expect(methods[1].name).toBe('secret');
    expect(methods[1].visibility).toBe('private');
  });

  it('extracts fields with visibility', () => {
    const entities = extractEntities(`class Dog {
public:
  int legs;
private:
  int age;
};
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    const legs = findByName(entities, 'legs');
    expect(legs!.visibility).toBe('public');
    const age = findByName(entities, 'age');
    expect(age!.visibility).toBe('private');
  });

  it('builds correct qualified names with namespace', () => {
    const entities = extractEntities(`namespace animals {
  class Dog {};
}
`, 'src/animals.cpp');
    const dog = findByName(entities, 'Dog');
    expect(dog!.qualified_name).toBe('src/animals.cpp/animals.Dog');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('class {');
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('C++ extractor — relations', () => {
  it('extracts import relations from #include', () => {
    const { relations } = extractRelations(`#include <iostream>
#include <string>
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend relations from inheritance', () => {
    const { relations } = extractRelations(`class Animal {};
class Dog : public Animal {};
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for class members', () => {
    const { relations } = extractRelations(`class Dog {
public:
  void bark() {}
  int age;
};
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts create relations from new expressions', () => {
    const { relations } = extractRelations(`class Animal {};

class Dog {
public:
  void make() { auto a = new Animal(); }
};
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for namespace members', () => {
    const { relations } = extractRelations(`namespace animals {
  class Dog {};
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });
});
