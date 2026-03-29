import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { bashExtractor } from '../../../../src/parser/extractors/bash-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'scripts/deploy.sh';

function extractEntities(code: string, filePath = FP): Entity[] {
  return bashExtractor.extractEntities(parse('bash', code).root(), filePath);
}

function extractRelations(code: string, filePath = FP) {
  const root = parse('bash', code).root();
  const entities = bashExtractor.extractEntities(root, filePath);
  const relations = bashExtractor.extractRelations(root, filePath, entities, '');
  return { entities, relations };
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

describe('Bash extractor — entities', () => {
  it('extracts function definitions (keyword style)', () => {
    const entities = extractEntities('function greet() {\n  echo "hi"\n}');
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('greet');
  });

  it('extracts function definitions (POSIX style)', () => {
    const entities = extractEntities('my_func() {\n  echo "hello"\n}');
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe('my_func');
  });

  it('extracts multiple functions', () => {
    const entities = extractEntities(`function greet() { echo "hi"; }
my_func() { echo "hello"; }`);
    const fns = findByKind(entities, 'function');
    expect(fns).toHaveLength(2);
  });

  it('handles empty input gracefully', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles commands without functions', () => {
    const entities = extractEntities('echo "hello"\nls -la');
    expect(entities).toHaveLength(0);
  });
});

describe('Bash extractor — relations', () => {
  it('extracts source as import relation', () => {
    const { relations } = extractRelations('source ./utils.sh');
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(1);
  });

  it('extracts dot-source as import relation', () => {
    const { relations } = extractRelations('. ./helpers.sh');
    const imports = relations.filter(r => r.type === 'import');
    expect(imports).toHaveLength(1);
  });

  it('extracts call relations between functions', () => {
    const { relations } = extractRelations(`function greet() { echo "hi"; }
function main() { greet; }`);
    const calls = relations.filter(r => r.type === 'call');
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });
});
