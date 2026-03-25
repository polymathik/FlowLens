import { describe, it, expect } from 'vitest';
import { discoverFiles } from '../../../src/discovery/file-walker.js';
import { join } from 'node:path';
import { LANGUAGE_EXTENSIONS } from '../../../src/utils/paths.js';

const FIXTURE = join(import.meta.dirname, '../../fixtures/multi-language');

describe('discoverFiles', () => {
  it('discovers files with supported extensions', async () => {
    const files = await discoverFiles({
      rootDir: FIXTURE,
      excludePatterns: ['ignored/**'],
      supportedExtensions: Object.keys(LANGUAGE_EXTENSIONS),
    });
    const names = files.map(f => f.path);
    expect(names).toContain('app.ts');
    expect(names).toContain('utils.js');
    expect(names).toContain('script.py');
    expect(names).toContain('main.go');
    expect(names).toContain('lib.rs');
    expect(names).toContain('App.java');
  });

  it('excludes files matching ignore patterns', async () => {
    const files = await discoverFiles({
      rootDir: FIXTURE,
      excludePatterns: ['ignored/**'],
      supportedExtensions: ['.ts'],
    });
    const names = files.map(f => f.path);
    expect(names).not.toContain('ignored/skip.ts');
  });

  it('assigns correct language', async () => {
    const files = await discoverFiles({
      rootDir: FIXTURE,
      excludePatterns: [],
      supportedExtensions: ['.py'],
    });
    expect(files[0].language).toBe('python');
  });

  it('sets absolutePath correctly', async () => {
    const files = await discoverFiles({
      rootDir: FIXTURE,
      excludePatterns: [],
      supportedExtensions: ['.ts'],
    });
    const tsFile = files.find(f => f.path === 'app.ts');
    expect(tsFile?.absolutePath).toBe(join(FIXTURE, 'app.ts'));
  });
});
