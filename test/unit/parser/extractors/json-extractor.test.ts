import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '@ast-grep/napi';
import { ensureLanguagesRegistered } from '../../../../src/parser/lang-registration.js';
import { jsonExtractor } from '../../../../src/parser/extractors/json-extractor.js';
import type { Entity, EntityKind } from '../../../../src/contracts/entities.js';

beforeAll(() => {
  ensureLanguagesRegistered();
});

const FP = 'package.json';

function extractEntities(code: string, filePath = FP): Entity[] {
  return jsonExtractor.extractEntities(parse('json', code).root(), filePath);
}

function findByKind(entities: Entity[], kind: EntityKind) {
  return entities.filter(e => e.kind === kind);
}

describe('JSON extractor — entities', () => {
  it('extracts top-level keys as fields', () => {
    const entities = extractEntities(
      '{"name": "test", "version": "1.0", "scripts": {"build": "tsc"}}',
    );
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(3);
    expect(fields[0].name).toBe('name');
    expect(fields[1].name).toBe('version');
    expect(fields[2].name).toBe('scripts');
  });

  it('does not extract nested keys', () => {
    const entities = extractEntities(
      '{"outer": {"inner": "value"}}',
    );
    const fields = findByKind(entities, 'field');
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe('outer');
  });

  it('handles empty object', () => {
    const entities = extractEntities('{}');
    expect(entities).toHaveLength(0);
  });

  it('handles empty input', () => {
    const entities = extractEntities('');
    expect(entities).toHaveLength(0);
  });

  it('handles array at top level (no fields)', () => {
    const entities = extractEntities('[1, 2, 3]');
    expect(entities).toHaveLength(0);
  });
});

describe('JSON extractor — relations', () => {
  it('returns empty relations (structural only)', () => {
    const root = parse('json', '{"key": "value"}').root();
    const entities = jsonExtractor.extractEntities(root, FP);
    const relations = jsonExtractor.extractRelations(root, FP, entities, '');
    expect(relations).toHaveLength(0);
  });
});
