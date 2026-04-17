import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseChunk,
  parallelParse,
  PARALLEL_THRESHOLD,
} from '../../../src/indexer/parallel-parser.js';
import type { DiscoveredFile } from '../../../src/contracts/discovery.js';

async function makeTsFile(root: string, rel: string, body: string): Promise<DiscoveredFile> {
  const full = join(root, rel);
  await mkdir(join(root, rel.split('/').slice(0, -1).join('/') || '.'), {
    recursive: true,
  });
  await writeFile(full, body);
  return {
    path: rel,
    absolutePath: full,
    extension: '.ts',
    language: 'typescript',
  };
}

describe('parseChunk (pure)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-parse-chunk-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('parses a single file and yields entities + hash', async () => {
    const file = await makeTsFile(tmp, 'a.ts', 'export class Foo { bar() {} }');

    const result = await parseChunk({ files: [file], rootDir: tmp });

    expect(result.failures).toHaveLength(0);
    expect(result.parsed).toHaveLength(1);
    const [parsed] = result.parsed;
    expect(parsed.path).toBe('a.ts');
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(parsed.entities.some((e) => e.name === 'Foo')).toBe(true);
  });

  it('handles multiple files independently', async () => {
    const files = [
      await makeTsFile(tmp, 'a.ts', 'export const x = 1;'),
      await makeTsFile(tmp, 'b.ts', 'export const y = 2;'),
    ];

    const result = await parseChunk({ files, rootDir: tmp });

    expect(result.parsed).toHaveLength(2);
    const paths = result.parsed.map((p) => p.path).sort();
    expect(paths).toEqual(['a.ts', 'b.ts']);
  });

  it('collects read failures without aborting the chunk', async () => {
    const existing = await makeTsFile(tmp, 'a.ts', 'const x = 1;');
    const missing: DiscoveredFile = {
      path: 'does-not-exist.ts',
      absolutePath: join(tmp, 'does-not-exist.ts'),
      extension: '.ts',
      language: 'typescript',
    };

    const result = await parseChunk({ files: [existing, missing], rootDir: tmp });

    expect(result.parsed).toHaveLength(1);
    expect(result.parsed[0].path).toBe('a.ts');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe('does-not-exist.ts');
  });

  it('different content produces different hashes', async () => {
    const a = await makeTsFile(tmp, 'a.ts', 'const x = 1;');
    const b = await makeTsFile(tmp, 'b.ts', 'const y = 2;');

    const result = await parseChunk({ files: [a, b], rootDir: tmp });

    const [parsedA, parsedB] = result.parsed;
    expect(parsedA.hash).not.toBe(parsedB.hash);
  });

  it('same content produces the same hash', async () => {
    const a = await makeTsFile(tmp, 'a.ts', 'const x = 1;');
    const b = await makeTsFile(tmp, 'b.ts', 'const x = 1;');

    const result = await parseChunk({ files: [a, b], rootDir: tmp });

    const [parsedA, parsedB] = result.parsed;
    expect(parsedA.hash).toBe(parsedB.hash);
  });
});

describe('parallelParse', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-parallel-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('falls back to serial below threshold', async () => {
    const files = [
      await makeTsFile(tmp, 'a.ts', 'export class A {}'),
      await makeTsFile(tmp, 'b.ts', 'export class B {}'),
    ];

    const result = await parallelParse(files, tmp);

    expect(result.parsed).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it('serial mode matches parseChunk output', async () => {
    const files = [
      await makeTsFile(tmp, 'a.ts', 'export class A {}'),
      await makeTsFile(tmp, 'b.ts', 'export class B {}'),
      await makeTsFile(tmp, 'c.ts', 'export class C {}'),
    ];

    const parallel = await parallelParse(files, tmp, { serial: true });
    const chunk = await parseChunk({ files, rootDir: tmp });

    // Same path set, same hashes — ordering identical because files iterate in arg order
    expect(parallel.parsed.map((p) => p.path)).toEqual(
      chunk.parsed.map((p) => p.path),
    );
    expect(parallel.parsed.map((p) => p.hash)).toEqual(
      chunk.parsed.map((p) => p.hash),
    );
  });

  it('PARALLEL_THRESHOLD is 1000', () => {
    // Guard against accidental regression — parallel startup cost isn't
    // worth it below this threshold.
    expect(PARALLEL_THRESHOLD).toBe(1000);
  });
});
