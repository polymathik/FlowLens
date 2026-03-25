import { describe, it, expect } from 'vitest';
import { resolveImportPath } from '../../../src/parser/import-resolver.js';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../fixtures/barrel-exports');

describe('resolveImportPath', () => {
  it('resolves relative path to .ts file', () => {
    const result = resolveImportPath('./foo', 'consumer.ts', ROOT);
    expect(result).toBe('foo.ts');
  });

  it('resolves relative path to .ts file from bar', () => {
    const result = resolveImportPath('./bar', 'consumer.ts', ROOT);
    expect(result).toBe('bar.ts');
  });

  it('resolves directory to index.ts', () => {
    const result = resolveImportPath('./subdir', 'dir-consumer.ts', ROOT);
    expect(result).toBe('subdir/index.ts');
  });

  it('resolves ./index to index.ts', () => {
    const result = resolveImportPath('./index', 'consumer.ts', ROOT);
    expect(result).toBe('index.ts');
  });

  it('returns null for external packages', () => {
    const result = resolveImportPath('lodash', 'consumer.ts', ROOT);
    expect(result).toBeNull();
  });

  it('returns null for node builtins', () => {
    const result = resolveImportPath('node:fs', 'consumer.ts', ROOT);
    expect(result).toBeNull();
  });

  it('returns null for unresolvable paths', () => {
    const result = resolveImportPath('./nonexistent', 'consumer.ts', ROOT);
    expect(result).toBeNull();
  });

  it('resolves exact file path with extension', () => {
    const result = resolveImportPath('./foo.ts', 'consumer.ts', ROOT);
    expect(result).toBe('foo.ts');
  });
});
