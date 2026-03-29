import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { rubyExtractor } from '../../../../src/parser/extractors/ruby-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.rb';

function extractEntities(code: string, filePath = FP): Entity[] {
  return rubyExtractor.extractEntities(parse('ruby', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('ruby', code).root();
  const entities = rubyExtractor.extractEntities(root, filePath);
  const relations = rubyExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

describe('Ruby extractor — entities', () => {
  it('extracts classes', () => {
    const entities = extractEntities('class Dog; end');
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Dog');
  });

  it('extracts modules as namespaces', () => {
    const entities = extractEntities('module Utils; end');
    const nss = findByKind(entities, 'namespace');
    expect(nss).toHaveLength(1);
    expect(nss[0].name).toBe('Utils');
  });

  it('extracts methods inside classes', () => {
    const entities = extractEntities(`class Dog
  def bark; end
  def fetch; end
end`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('bark');
  });

  it('extracts singleton methods', () => {
    const entities = extractEntities(`class Dog
  def self.create(name)
  end
end`);
    const methods = findByKind(entities, 'method');
    expect(methods.length).toBeGreaterThanOrEqual(1);
    expect(methods[0].name).toBe('create');
  });

  it('extracts attr_accessor as fields', () => {
    const entities = extractEntities(`class Dog
  attr_accessor :name, :age
end`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('age');
  });

  it('extracts top-level variables', () => {
    const entities = extractEntities('x = 42');
    const vars = findByKind(entities, 'variable');
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe('x');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });
});

describe('Ruby extractor — relations', () => {
  it('extracts require as import relations', () => {
    const { relations } = extractRelations("require 'json'\nrequire_relative 'utils'");
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend (inheritance) relations', () => {
    const { relations } = extractRelations(`class Animal; end
class Dog < Animal; end`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts mixin (include) relations', () => {
    const { relations } = extractRelations(`module Walkable; end
class Dog
  include Walkable
end`);
    const mixins = relations.filter(r => r.type === 'mixin');
    expect(mixins.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create (.new) relations', () => {
    const { relations } = extractRelations(`class Dog; end
class Factory
  def make
    Dog.new
  end
end`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for methods', () => {
    const { relations } = extractRelations(`class Dog
  def bark; end
end`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for attr fields', () => {
    const { relations } = extractRelations(`class Dog
  attr_accessor :name
end`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });
});
