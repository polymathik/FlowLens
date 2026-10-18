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
    // slashless nested patterns apply at any depth below their directory
    expect(patterns).toContain('subdir/**/local-build/');
  });

  it('applies slashless nested patterns recursively and anchors slashed ones', async () => {
    await mkdir(join(tmpDir, 'pkg', 'deep', 'gen'), { recursive: true });
    await writeFile(join(tmpDir, 'pkg', '.gitignore'), '*.gen.ts\n/only-here.ts\nsub/x.ts\n!keep.gen.ts\n');
    const patterns = await loadIgnorePatterns(tmpDir);
    const ignored = buildIgnoreFilter(patterns);
    expect(ignored('pkg/a.gen.ts')).toBe(true);
    expect(ignored('pkg/deep/gen/b.gen.ts')).toBe(true);
    expect(ignored('pkg/deep/keep.gen.ts')).toBe(false);
    expect(ignored('pkg/only-here.ts')).toBe(true);
    expect(ignored('pkg/deep/only-here.ts')).toBe(false);
    expect(ignored('pkg/sub/x.ts')).toBe(true);
    expect(ignored('pkg/deep/sub/x.ts')).toBe(false);
    expect(ignored('other/a.gen.ts')).toBe(false);
  });

  it('returns empty array when no ignore files exist', async () => {
    const patterns = await loadIgnorePatterns(tmpDir);
    expect(patterns).toEqual([]);
  });
});
