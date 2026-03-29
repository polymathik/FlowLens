import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { cExtractor } from '../../../../src/parser/extractors/c-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'src/main.c';

function extractEntities(code: string, filePath = FP): Entity[] {
  return cExtractor.extractEntities(parse('c', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('c', code).root();
  const entities = cExtractor.extractEntities(root, filePath);
  const relations = cExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

function findByName(entities: Entity[], name: string) {
  return entities.find(e => e.name === name);
}

describe('C extractor — entities', () => {
  it('extracts functions', () => {
    const entities = extractEntities(`int add(int a, int b) {
  return a + b;
}

void hello() {}
`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe('add');
    expect(fns[1].name).toBe('hello');
  });

  it('extracts structs as classes with fields', () => {
    const entities = extractEntities(`struct Point {
  int x;
  int y;
};
`);
    const classes = findByKind(entities, 'class');
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('Point');

    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe('x');
    expect(fields[1].name).toBe('y');
  });

  it('extracts variables', () => {
    const entities = extractEntities(`int main() {
  int result = 42;
  return 0;
}
`);
    const vars = findByKind(entities, 'variable');
    expect(vars.length).toBeGreaterThanOrEqual(1);
    expect(vars.find(v => v.name === 'result')).toBeDefined();
  });

  it('builds correct qualified names', () => {
    const entities = extractEntities(`struct Point {
  int x;
};
`, 'lib/point.c');
    const field = findByName(entities, 'x');
    expect(field!.qualified_name).toBe('lib/point.c/Point.x');
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles broken input gracefully', () => {
    const entities = extractEntities('int ');
    expect(Array.isArray(entities)).toBe(true);
  });
});

describe('C extractor — relations', () => {
  it('extracts import relations from #include', () => {
    const { relations } = extractRelations(`#include <stdio.h>
#include "myheader.h"
`);
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(2);
  });

  it('extracts call relations', () => {
    const { relations } = extractRelations(`int add(int a, int b) { return a + b; }

int main() {
  int r = add(1, 2);
  return 0;
}
`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts contain relations for struct fields', () => {
    const { relations } = extractRelations(`struct Point {
  int x;
  int y;
};
`);
    const contains = relations.filter(r => r.type === 'contain');
    expect(contains.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts use relations for field access', () => {
    const { relations } = extractRelations(`struct Point {
  int x;
  int y;
};

int main() {
  struct Point p;
  p.x = 10;
  return 0;
}
`);
    const uses = relations.filter(r => r.type === 'use');
    expect(uses.length).toBeGreaterThanOrEqual(1);
  });
});
