import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { pythonExtractor } from '../../../../src/parser/extractors/python-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';
import type { RelationType } from '../../../../src/contracts/relations.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/app.py';

function extractEntities(code: string, filePath = FP): Entity[] {
  return pythonExtractor.extractEntities(parse('python', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('python', code).root();
  const entities = pythonExtractor.extractEntities(root, filePath);
  const relations = pythonExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Python extractor — entities', () => {
  it('extracts classes with correct kind and visibility', () => {
    const entities = extractEntities(`
class Animal:
    pass

class Dog(Animal):
    pass
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(2);
    expect(classes[0].name).toBe('Animal');
    expect(classes[0].kind).toBe('class');
    expect(classes[0].visibility).toBe('public');
    expect(classes[1].name).toBe('Dog');
  });

  it('extracts module-level functions', () => {
    const entities = extractEntities(`
def helper(x: int) -> int:
    return x * 2

def _private_helper():
    pass
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe('helper');
    expect(fns[0].visibility).toBe('public');
    expect(fns[1].name).toBe('_private_helper');
    expect(fns[1].visibility).toBe('protected');
  });

  it('extracts methods inside class', () => {
    const entities = extractEntities(`
class Foo:
    def bar(self):
        pass
    def __secret(self):
        pass
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('bar');
    expect(methods[0].kind).toBe('method');
    expect(methods[0].visibility).toBe('public');
    expect(methods[1].name).toBe('__secret');
    expect(methods[1].visibility).toBe('private');
  });

  it('extracts class fields from assignments', () => {
    const entities = extractEntities(`
class Config:
    host: str = "localhost"
    port: int = 8080
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('host');
    expect(fields[1].name).toBe('port');
  });

  it('extracts module-level variables', () => {
    const entities = extractEntities(`
MAX_RETRIES = 3
DEBUG = True
`);
    const vars = findByKind(entities, 'variable');
    expect(vars).toHaveLength(2);
    expect(vars[0].name).toBe('MAX_RETRIES');
    expect(vars[1].name).toBe('DEBUG');
  });

  it('extracts decorators', () => {
    const entities = extractEntities(`
@abstractmethod
def speak(self):
    pass
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs).toHaveLength(1);
    expect(decs[0].name).toBe('abstractmethod');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`
class Dog:
    def speak(self):
        pass
`, 'src/models.py');
    const method = findByName(entities, 'speak');
    expect(method!.qualified_name).toBe('src/models.py/Dog.speak');
  });

  it('uses 1-based line numbers', () => {
    const entities = extractEntities(`class Foo:
    pass`);
    const cls = findByName(entities, 'Foo');
    expect(cls!.location.line_start).toBe(1);
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('def ');
    // Should not throw, may produce partial results
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('Python extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations(`
import os
from typing import List
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend relations from class inheritance', () => {
    const { relations } = extractRelations(`
class Animal:
    pass

class Dog(Animal):
    pass
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts implement relations for ABC', () => {
    const { relations } = extractRelations(`
class Animal(ABC):
    pass
`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls).toHaveLength(1);
  });

  it('extracts contain relations for methods in class', () => {
    const { relations } = extractRelations(`
class Foo:
    def bar(self):
        pass
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts call relations', () => {
    const { entities, relations } = extractRelations(`
def helper():
    pass

def main():
    helper()
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations for class instantiation', () => {
    const { relations } = extractRelations(`
class Dog:
    pass

def make_dog():
    return Dog()
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations', () => {
    const { relations } = extractRelations(`
class Foo:
    @abstractmethod
    def bar(self):
        pass
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });
});
