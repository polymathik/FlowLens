import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSyntheticProject } from '../../../benchmarks/synthetic-project-generator.js';

describe('generateSyntheticProject', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-gen-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('creates the requested number of files', async () => {
    await generateSyntheticProject({ rootDir: tmp, fileCount: 10 });
    const files = await readdir(join(tmp, 'src'));
    expect(files).toHaveLength(10);
    expect(files.every((f) => f.startsWith('mod') && f.endsWith('.ts'))).toBe(true);
  });

  it('generates syntactically valid TypeScript', async () => {
    await generateSyntheticProject({ rootDir: tmp, fileCount: 3 });
    const content = await readFile(join(tmp, 'src', 'mod0.ts'), 'utf-8');
    // Class declaration + method + function export — exercises entity extractors
    expect(content).toMatch(/export class Class0/);
    expect(content).toMatch(/method\d/);
    expect(content).toMatch(/export function helper0/);
  });

  it('generates imports between files (cross-file edges)', async () => {
    await generateSyntheticProject({ rootDir: tmp, fileCount: 20, seed: 1 });
    const content = await readFile(join(tmp, 'src', 'mod0.ts'), 'utf-8');
    expect(content).toMatch(/import \{ Class\d+ \} from '\.\/mod\d+\.js';/);
  });

  it('is deterministic with the same seed', async () => {
    await generateSyntheticProject({ rootDir: tmp, fileCount: 3, seed: 42 });
    const first = await readFile(join(tmp, 'src', 'mod0.ts'), 'utf-8');

    const tmp2 = await mkdtemp(join(tmpdir(), 'flowlens-gen-'));
    try {
      await generateSyntheticProject({ rootDir: tmp2, fileCount: 3, seed: 42 });
      const second = await readFile(join(tmp2, 'src', 'mod0.ts'), 'utf-8');
      expect(first).toBe(second);
    } finally {
      await rm(tmp2, { recursive: true, force: true });
    }
  });

  it('writes a tsconfig.json and package.json', async () => {
    await generateSyntheticProject({ rootDir: tmp, fileCount: 1 });
    const tsconfig = JSON.parse(await readFile(join(tmp, 'tsconfig.json'), 'utf-8'));
    const pkg = JSON.parse(await readFile(join(tmp, 'package.json'), 'utf-8'));
    expect(tsconfig.compilerOptions).toBeDefined();
    expect(pkg.name).toBe('synthetic');
  });
});
