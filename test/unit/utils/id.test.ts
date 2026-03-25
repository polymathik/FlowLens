import { describe, it, expect } from 'vitest';
import { generateEntityId, generateRelationId } from '../../../src/utils/id.js';

describe('generateEntityId', () => {
  it('is deterministic for same inputs', () => {
    const id1 = generateEntityId('src/foo.ts', 'Foo', 'class');
    const id2 = generateEntityId('src/foo.ts', 'Foo', 'class');
    expect(id1).toBe(id2);
  });

  it('is 16 hex chars', () => {
    const id = generateEntityId('src/foo.ts', 'Foo', 'class');
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('differs for different inputs', () => {
    const id1 = generateEntityId('src/foo.ts', 'Foo', 'class');
    const id2 = generateEntityId('src/foo.ts', 'Bar', 'class');
    expect(id1).not.toBe(id2);
  });

  it('differs by kind for same name', () => {
    const id1 = generateEntityId('src/foo.ts', 'Foo', 'class');
    const id2 = generateEntityId('src/foo.ts', 'Foo', 'function');
    expect(id1).not.toBe(id2);
  });
});

describe('generateRelationId', () => {
  it('is deterministic', () => {
    const id1 = generateRelationId('a', 'b', 'import', 'src/foo.ts', 1);
    const id2 = generateRelationId('a', 'b', 'import', 'src/foo.ts', 1);
    expect(id1).toBe(id2);
  });

  it('is 16 hex chars', () => {
    const id = generateRelationId('a', 'b', 'import', 'src/foo.ts', 1);
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });
});
