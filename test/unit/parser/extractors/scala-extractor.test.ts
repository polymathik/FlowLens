import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { scalaExtractor } from '../../../../src/parser/extractors/scala-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.scala';

function extractEntities(code: string, filePath = FP): Entity[] {
  return scalaExtractor.extractEntities(parse('scala', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('scala', code).root();
  const entities = scalaExtractor.extractEntities(root, filePath);
  const relations = scalaExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Scala extractor — entities', () => {
  it('extracts classes', () => {
    const entities = extractEntities('class Foo {}');
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Foo');
  });

  it('extracts traits as interfaces', () => {
    const entities = extractEntities(`trait MyTrait {
  def method(): Unit
}`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('MyTrait');
    const methods = findByKind(entities, 'method');
    expect(methods.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts objects as classes', () => {
    const entities = extractEntities('object Singleton { val x = 1 }');
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Singleton');
  });

  it('extracts methods and functions', () => {
    const entities = extractEntities(`object App {
  def run(): Unit = {}
}
def topLevel(): Unit = {}
`);
    const methods = findByKind(entities, 'method');
    expect(methods.length).toBeGreaterThanOrEqual(1);
    expect(methods[0].name).toBe('run');
  });

  it('extracts val/var as fields inside class', () => {
    const entities = extractEntities(`class Foo {
  val x = 1
  var y = 2
}`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('x');
    expect(fields[1].name).toBe('y');
  });

  it('extracts case class parameters as fields', () => {
    const entities = extractEntities('case class Point(x: Int, y: Int)');
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
  });

  it('extracts annotations as decorators', () => {
    const entities = extractEntities(`@deprecated
class Foo {}`);
    const decorators = findByKind(entities, 'decorator');
    expect(decorators).toHaveLength(1);
    expect(decorators[0].name).toBe('deprecated');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });
});

describe('Scala extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations('import scala.collection.mutable');
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(1);
  });

  it('extracts extend relations', () => {
    const { relations } = extractRelations(`class Bar {}
class Foo extends Bar {}`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts implement (with) relations', () => {
    const { relations } = extractRelations(`trait Baz {}
class Foo extends Bar with Baz {}`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations from new', () => {
    const { relations } = extractRelations(`class Bar {}
object Main {
  def run(): Unit = {
    val b = new Bar()
  }
}`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations', () => {
    const { relations } = extractRelations(`class Foo {
  val x = 1
  def hello(): Unit = {}
}`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts decorate relations from annotations', () => {
    const { relations } = extractRelations(`@deprecated
class Foo {}`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates).toHaveLength(1);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`object Main {
  def greet(): Unit = {}
  def run(): Unit = {
    greet()
  }
}`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
