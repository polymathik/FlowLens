import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { swiftExtractor } from '../../../../src/parser/extractors/swift-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/App.swift';

function extractEntities(code: string, filePath = FP): Entity[] {
  return swiftExtractor.extractEntities(parse('swift', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('swift', code).root();
  const entities = swiftExtractor.extractEntities(root, filePath);
  const relations = swiftExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Swift extractor — entities', () => {
  it('extracts classes', () => {
    const entities = extractEntities(`class Animal {
  var name: String = ""
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Animal');
  });

  it('extracts structs as classes', () => {
    const entities = extractEntities(`struct Point {
  var x: Int
  var y: Int
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Point');

    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
  });

  it('extracts protocols as interfaces', () => {
    const entities = extractEntities(`protocol Speakable {
  func speak() -> String
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Speakable');

    // protocol methods
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('speak');
  });

  it('extracts enums with cases', () => {
    const entities = extractEntities(`enum Color {
  case red
  case blue
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Color');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(2);
    expect(members.map(m => m.name).sort()).toEqual(['blue', 'red']);
  });

  it('extracts functions and methods', () => {
    const entities = extractEntities(`func greet() -> String { return "Hello" }

class Dog {
  func bark() {}
}
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('greet');

    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('bark');
  });

  it('extracts properties/fields', () => {
    const entities = extractEntities(`class Config {
  var host: String = "localhost"
  let port: Int = 8080
}
`);
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('host');
    expect(fields[1].name).toBe('port');
  });

  it('extracts decorators from attributes', () => {
    const entities = extractEntities(`@objc class Animal {
  var name: String = ""
}
`);
    const decs = findByKind(entities, 'decorator');
    expect(decs).toHaveLength(1);
    expect(decs[0].name).toBe('objc');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`class Dog {
  func speak() {}
}
`, 'lib/Dog.swift');
    const method = findByName(entities, 'speak');
    expect(method!.qualified_name).toBe('lib/Dog.swift/Dog.speak');
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

describe('Swift extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations(`import Foundation
import UIKit
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts extend/implement relations from inheritance', () => {
    const { relations } = extractRelations(`protocol Speakable {
  func speak() -> String
}

class Animal {
  var name: String = ""
}

class Dog: Animal, Speakable {
  func speak() -> String { return "Woof" }
}
`);
    const extends_ = relations.filter(r => r.type === 'extend');
    expect(extends_.length).toBeGreaterThanOrEqual(1);

    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for class members', () => {
    const { relations } = extractRelations(`class Dog {
  var name: String = ""
  func bark() {}
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts create relations from constructor calls', () => {
    const { relations } = extractRelations(`class Animal {
  var name: String = ""
}

class Factory {
  func make() {
    let a = Animal()
  }
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts decorate relations', () => {
    const { relations } = extractRelations(`@objc class Animal {
  var name: String = ""
}
`);
    const decorates = relations.filter(r => r.type === 'decorate');
    expect(decorates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`func helper() -> String { return "hi" }

func main() {
  let r = helper()
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
