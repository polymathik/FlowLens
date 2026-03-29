import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { goExtractor } from '../../../../src/parser/extractors/go-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.go';

function extractEntities(code: string, filePath = FP): Entity[] {
  return goExtractor.extractEntities(parse('go', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('go', code).root();
  const entities = goExtractor.extractEntities(root, filePath);
  const relations = goExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('Go extractor — entities', () => {
  it('extracts functions', () => {
    const entities = extractEntities(`package main

func Hello() {}
func helper() {}
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe('Hello');
    expect(fns[0].visibility).toBe('public');
    expect(fns[1].name).toBe('helper');
    expect(fns[1].visibility).toBe('internal');
  });

  it('extracts structs as classes with fields', () => {
    const entities = extractEntities(`package main

type Dog struct {
  Name string
  age  int
}
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Dog');
    expect(classes[0].visibility).toBe('public');

    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('Name');
    expect(fields[0].visibility).toBe('public');
    expect(fields[1].name).toBe('age');
    expect(fields[1].visibility).toBe('internal');
  });

  it('extracts interfaces', () => {
    const entities = extractEntities(`package main

type Animal interface {
  Speak() string
}
`);
    const ifaces = findByKind(entities, 'interface');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('Animal');
  });

  it('extracts methods with receiver type in qualified name', () => {
    const entities = extractEntities(`package main

type Dog struct{}

func (d Dog) Speak() string {
  return "Woof"
}
`);
    const methods = findByKind(entities, 'method');
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe('Speak');
    expect(methods[0].qualified_name).toContain('Dog.Speak');
  });

  it('extracts variables from var declarations', () => {
    const entities = extractEntities(`package main

var MaxRetries = 3
`);
    const vars = findByKind(entities, 'variable');
    expect(vars).toHaveLength(1);
    expect(vars[0].name).toBe('MaxRetries');
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`package main

type Dog struct {
  Name string
}
`, 'pkg/models.go');
    const field = findByName(entities, 'Name');
    expect(field!.qualified_name).toBe('pkg/models.go/Dog.Name');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles minimal package-only input', () => {
    const entities = extractEntities('package main\n');
    expect(entities).toHaveLength(0);
  });
});

describe('Go extractor — relations', () => {
  it('extracts import relations', () => {
    const { relations } = extractRelations(`package main

import "fmt"
import (
  "os"
  "strings"
)
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(3);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`package main

func helper() {}

func main() {
  helper()
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts create relations from composite literals', () => {
    const { relations } = extractRelations(`package main

type Dog struct {
  Name string
}

func main() {
  d := Dog{Name: "Rex"}
}
`);
    const creates = relations.filter(r => r.type === 'create');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for struct fields', () => {
    const { relations } = extractRelations(`package main

type Dog struct {
  Name string
  Age  int
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts contain relations for methods', () => {
    const { relations } = extractRelations(`package main

type Dog struct{}

func (d Dog) Speak() string {
  return "Woof"
}
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(1);
  });
});
