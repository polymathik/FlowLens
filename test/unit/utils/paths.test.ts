import { describe, it, expect } from 'vitest';
import { extensionToLanguage, normalizeRelativePath, isDeepExtractionLanguage } from '../../../src/utils/paths.js';

describe('extensionToLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(extensionToLanguage('.ts')).toBe('typescript');
  });

  it('maps .py to python', () => {
    expect(extensionToLanguage('.py')).toBe('python');
  });

  it('maps .go to go', () => {
    expect(extensionToLanguage('.go')).toBe('go');
  });

  it('returns null for unknown extensions', () => {
    expect(extensionToLanguage('.xyz')).toBeNull();
  });
});

describe('isDeepExtractionLanguage', () => {
  it('returns true for typescript', () => {
    expect(isDeepExtractionLanguage('typescript')).toBe(true);
  });

  it('returns false for python', () => {
    expect(isDeepExtractionLanguage('python')).toBe(false);
  });
});

describe('normalizeRelativePath', () => {
  it('strips leading ./', () => {
    expect(normalizeRelativePath('./src/foo.ts')).toBe('src/foo.ts');
  });

  it('uses forward slashes', () => {
    expect(normalizeRelativePath('src\\foo\\bar.ts')).toBe('src/foo/bar.ts');
  });
});
