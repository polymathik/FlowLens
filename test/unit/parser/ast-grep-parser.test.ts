import { describe, it, expect } from 'vitest';
import { AstGrepParser } from '../../../src/parser/ast-grep-parser.js';

describe('AstGrepParser', () => {
  const parser = new AstGrepParser();

  it('supports .ts extension', () => {
    expect(parser.supportsExtension('.ts')).toBe(true);
  });

  it('supports .py extension', () => {
    expect(parser.supportsExtension('.py')).toBe(true);
  });

  it('does not support .xyz extension', () => {
    expect(parser.supportsExtension('.xyz')).toBe(false);
  });

  it('has deep extractor for typescript', () => {
    expect(parser.hasDeepExtractor('typescript')).toBe(true);
  });

  it('does not have deep extractor for python', () => {
    expect(parser.hasDeepExtractor('python')).toBe(false);
  });

  it('creates basic file entity for Python', async () => {
    const result = await parser.parseFile('src/script.py', 'x = 1\ny = 2\n');
    expect(result.language).toBe('python');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe('file');
    expect(result.entities[0].language).toBe('python');
    expect(result.entities[0].metrics?.line_count).toBe(2);
  });

  it('creates basic file entity for Go', async () => {
    const result = await parser.parseFile('src/main.go', 'package main\n\nfunc main() {}\n');
    expect(result.language).toBe('go');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe('file');
  });

  it('creates file entity and extracted entities for TypeScript', async () => {
    const result = await parser.parseFile('src/foo.ts', 'export class Foo {}');
    expect(result.language).toBe('typescript');
    // Should have a file entity plus the extracted class entity
    expect(result.entities.length).toBeGreaterThanOrEqual(2);
    expect(result.entities.find(e => e.kind === 'file')).toBeDefined();
    expect(result.entities.find(e => e.kind === 'class')).toBeDefined();
  });

  it('handles empty content', async () => {
    const result = await parser.parseFile('src/empty.ts', '');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe('file');
    expect(result.entities[0].metrics?.line_count).toBe(0);
  });

  it('populates file entity fields correctly', async () => {
    const result = await parser.parseFile('src/utils/helper.py', 'def foo():\n    pass\n');
    const fileEntity = result.entities[0];
    expect(fileEntity.name).toBe('helper.py');
    expect(fileEntity.qualified_name).toBe('src/utils/helper.py');
    expect(fileEntity.file).toBe('src/utils/helper.py');
    expect(fileEntity.visibility).toBe('public');
    expect(fileEntity.location.line_start).toBe(1);
    expect(fileEntity.location.line_end).toBe(2);
  });

  it('parses Python with dynamic language registration', async () => {
    const result = await parser.parseFile('test.py', 'class Foo:\n    pass\n');
    expect(result.language).toBe('python');
    expect(result.entities.length).toBeGreaterThanOrEqual(1); // at least file entity
    expect(result.errors).toHaveLength(0); // should parse without errors now
  });

  it('parses Go with dynamic language registration', async () => {
    const result = await parser.parseFile('main.go', 'package main\nfunc main() {}\n');
    expect(result.language).toBe('go');
    expect(result.errors).toHaveLength(0);
  });
});
