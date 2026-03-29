import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { yamlExtractor } from '../../../../src/parser/extractors/yaml-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'config.yaml';

function extractEntities(code: string, filePath = FP): Entity[] {
  return yamlExtractor.extractEntities(parse('yaml', code).root(), filePath);
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

describe('YAML extractor — entities', () => {
  it('extracts top-level keys as fields', () => {
    const entities = extractEntities('name: test\nversion: 1.0\nscripts:\n  build: tsc\n');
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(3);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('version');
    expect(fields[2].name).toBe('scripts');
  });

  it('does not extract nested keys', () => {
    const entities = extractEntities('outer:\n  inner: value\n');
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('outer');
  });

  it('handles empty input', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles single key', () => {
    const entities = extractEntities('key: value\n');
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('key');
  });
});

describe('YAML extractor — relations', () => {
  it('returns empty relations (structural only)', () => {
    const root = parse('yaml', 'key: value\n').root();
    const entities = yamlExtractor.extractEntities(root, FP);
    const relations = yamlExtractor.extractRelations(root, FP, entities, '');
    expect(relations).toHaveLength(0);
  });
});
