import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { rustExtractor } from '../../../../src/parser/extractors/rust-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.rs';

function extractEntities(code: string, filePath = FP): Entity[] {
  return rustExtractor.extractEntities(parse('rust', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('rust', code).root();
  const entities = rustExtractor.extractEntities(root, filePath);
  const relations = rustExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Rust extractor — entities', () => {
  it('extracts functions', () => {
    const entities = extractEntities(`fn greet(name: &str) -> String {
  format!("Hello {}", name)
}

pub fn hello() {}
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe('greet');
    expect(fns[0].visibility).toBe('internal');
    expect(fns[1].name).toBe('hello');
    expect(fns[1].visibility).toBe('public');
  });

  it('extracts structs as classes with fields', () => {
    const entities = extractEntities(`struct Dog {
  name: String,
  age: u32,
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Dog');

    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('age');
  });

  it('extracts enums with variants', () => {
    const entities = extractEntities(`enum Color {
  Red,
  Blue,
  Green,
}
`);
    const enums = findByKind(entities, 'enum');
    expect(enums).toHaveLength(1);
    expect(enums[0].name).toBe('Color');

    const members = findByKind(entities, 'enum_member');
    expect(members).toHaveLength(3);
    expect(members.map(m => m.name).sort()).toEqual(['Blue', 'Green', 'Red']);
  });

  it('extracts traits as interfaces', () => {
    const entities = extractEntities(`trait Speak {
  fn speak(&self) -> String;
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Speak');

    // trait methods
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('speak');
  });

  it('extracts impl methods', () => {
    const entities = extractEntities(`struct Dog {}

impl Dog {
  fn new(name: String) -> Self {
    Dog { name, age: 0 }
  }
  pub fn bark(&self) {}
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].name).toBe('new');
    expect(methods[0].visibility).toBe('internal');
    expect(methods[1].name).toBe('bark');
    expect(methods[1].visibility).toBe('public');
  });

  it('builds correct qualified names for impl methods', () => {
    const entities = extractEntities(`struct Dog {}

impl Dog {
  fn new() -> Self { Dog {} }
}
`);
    const method = findByName(entities, 'new');
    expect(method!.qualified_name).toContain('Dog.new');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('fn ');
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('Rust extractor — relations', () => {
  it('extracts import relations from use and mod', () => {
    const { relations } = extractRelations(`use std::collections::HashMap;

mod utils;
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts implement relations', () => {
    const { relations } = extractRelations(`trait Speak {
  fn speak(&self) -> String;
}

struct Dog {
  name: String,
}

impl Speak for Dog {
  fn speak(&self) -> String {
    format!("Woof from {}", self.name)
  }
}
`);
    const impls = relations.filter(r => r.type === 'implement');
    expect(impls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for struct fields', () => {
    const { relations } = extractRelations(`struct Dog {
  name: String,
  age: u32,
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts create relations from struct expressions', () => {
    const { relations } = extractRelations(`struct Dog {
  name: String,
}

impl Dog {
  fn new(name: String) -> Self {
    Dog { name }
  }
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`struct Dog {}

impl Dog {
  fn new() -> Self { Dog {} }
  fn bark(&self) {}
}

fn main() {
  let d = Dog::new();
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for impl methods', () => {
    const { relations } = extractRelations(`struct Dog {}

impl Dog {
  fn new() -> Self { Dog {} }
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });
});
