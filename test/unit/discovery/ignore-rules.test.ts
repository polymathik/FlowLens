import { describe, it, expect, beforeEach } from 'vitest';
import { buildIgnoreFilter, loadIgnorePatterns } from '../../../src/discovery/ignore-rules.js';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

describe('loadIgnorePatterns', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-ignore-'));
  });

  it('loads root .gitignore patterns', async () => {
    await writeFile(join(tmpDir, '.gitignore'), 'dist/\n*.log\n');
    const patterns = await loadIgnorePatterns(tmpDir);
    expect(patterns).toContain('dist/');
    expect(patterns).toContain('*.log');
  });

  it('loads .flowlensignore with higher precedence', async () => {
    await writeFile(join(tmpDir, '.flowlensignore'), 'custom-ignore/\n');
    await writeFile(join(tmpDir, '.gitignore'), 'dist/\n');
    const patterns = await loadIgnorePatterns(tmpDir);
    // .flowlensignore patterns come first
    expect(patterns[0]).toBe('custom-ignore/');
    expect(patterns).toContain('dist/');
  });

  it('loads nested .gitignore with directory prefix', async () => {
    await mkdir(join(tmpDir, 'subdir'), { recursive: true });
    await writeFile(join(tmpDir, '.gitignore'), 'root-ignore/\n');
    await writeFile(join(tmpDir, 'subdir', '.gitignore'), 'local-build/\n');

    const patterns = await loadIgnorePatterns(tmpDir);
    expect(patterns).toContain('root-ignore/');
    expect(patterns).toContain('subdir/local-build/');
  });

  it('returns empty array when no ignore files exist', async () => {
    const patterns = await loadIgnorePatterns(tmpDir);
    expect(patterns).toEqual([]);
  });
});
