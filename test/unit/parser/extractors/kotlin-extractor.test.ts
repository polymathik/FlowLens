import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { kotlinExtractor } from '../../../../src/parser/extractors/kotlin-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/Main.kt';

function extractEntities(code: string, filePath = FP): Entity[] {
  return kotlinExtractor.extractEntities(parse('kotlin', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('kotlin', code).root();
  const entities = kotlinExtractor.extractEntities(root, filePath);
  const relations = kotlinExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Kotlin extractor — entities', () => {
  it('extracts classes with correct visibility', () => {
    const entities = extractEntities(`
class Dog(name: String)
private class Secret
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(2);
    expect(classes[0].name).toBe('Dog');
    expect(classes[0].visibility).toBe('public');
    expect(classes[1].name).toBe('Secret');
    expect(classes[1].visibility).toBe('private');
  });

  it('extracts interfaces', () => {
    const entities = extractEntities(`
interface Greeter {
    fun greet(name: String): String
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Greeter');
  });

  it('extracts enum classes and members', () => {
    const entities = extractEntities(`
enum class Status {
    ACTIVE,
    INACTIVE
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Status');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(2);
    expect(members.map(m => m.name).sort()).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('extracts top-level functions', () => {
    const entities = extractEntities(`
fun topLevel(x: Int): Int = x * 2
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('topLevel');
    expect(fns[0].kind).toBe('function');
  });

  it('extracts methods inside class', () => {
    const entities = extractEntities(`
class Foo {
    fun bar() {}
    private fun secret() {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('bar');
    expect(methods[0].visibility).toBe('public');
    expect(methods[1].name).toBe('secret');
    expect(methods[1].visibility).toBe('private');
  });

  it('extracts object declarations as class', () => {
    const entities = extractEntities(`
object DogFactory {
    fun create(name: String): String = name
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('DogFactory');
  });

  it('extracts properties as fields inside class', () => {
    const entities = extractEntities(`
class Foo {
    val name: String = "test"
    private val secret: Int = 0
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('secret');
    expect(fields[1].visibility).toBe('private');
  });

  it('extracts top-level properties as variables', () => {
    const entities = extractEntities(`
val MAX_PETS = 10
`);
    const vars = findByKind(entities, 'variable');
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe('MAX_PETS');
  });

  it('extracts annotation classes as decorator entities', () => {
    const entities = extractEntities(`
annotation class Route(val path: String)
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs).toHaveLength(1);
    expect(decs[0].name).toBe('Route');
  });

  it('extracts annotation usages as decorator entities', () => {
    const entities = extractEntities(`
@Route("/api")
class Controller {}
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs.length).toBeGreaterThanOrEqual(1);
    expect(decs[0].name).toBe('Route');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`
class Dog {
    fun speak(): String = "Woof"
}
`, 'src/Dog.kt');
    const method = findByName(entities, 'speak');
    expect(method!.qualified_name).toBe('src/Dog.kt/Dog.speak');
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

describe('Kotlin extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations(`
import kotlin.collections.List
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(1);
  });

  it('extracts extend relations from class inheritance', () => {
    const { relations } = extractRelations(`
abstract class Animal(val name: String)
class Dog(name: String) : Animal(name)
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for methods', () => {
    const { relations } = extractRelations(`
class Foo {
    fun bar() {}
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`
fun helper() {}
fun main() {
    helper()
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations for constructor calls', () => {
    const { relations } = extractRelations(`
class Dog(val name: String)
fun main() {
    val d = Dog("Rex")
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations from annotations', () => {
    const { relations } = extractRelations(`
@Route("/api")
class Controller {}
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });
});
