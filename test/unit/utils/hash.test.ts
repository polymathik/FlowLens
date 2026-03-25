import { describe, it, expect } from 'vitest';
import { hashContent } from '../../../src/utils/hash.js';

describe('hashContent', () => {
  it('produces deterministic SHA-256 hex string', () => {
    const hash1 = hashContent('hello world');
    const hash2 = hashContent('hello world');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different content', () => {
    expect(hashContent('hello')).not.toBe(hashContent('world'));
  });
});
