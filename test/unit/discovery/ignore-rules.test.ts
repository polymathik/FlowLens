import { describe, it, expect } from 'vitest';
import { buildIgnoreFilter } from '../../../src/discovery/ignore-rules.js';

describe('buildIgnoreFilter', () => {
  it('filters node_modules', () => {
    const filter = buildIgnoreFilter(['node_modules/**']);
    expect(filter('node_modules/foo/bar.js')).toBe(true);
    expect(filter('src/index.ts')).toBe(false);
  });

  it('combines multiple patterns', () => {
    const filter = buildIgnoreFilter(['dist/**', '*.log']);
    expect(filter('dist/bundle.js')).toBe(true);
    expect(filter('error.log')).toBe(true);
    expect(filter('src/app.ts')).toBe(false);
  });
});
