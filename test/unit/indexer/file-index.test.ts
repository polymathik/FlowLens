import { describe, it, expect, beforeEach } from 'vitest';
import { FileIndexManager } from '../../../src/indexer/file-index.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('FileIndexManager', () => {
  let tmpDir: string;
  let manager: FileIndexManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-idx-'));
    manager = new FileIndexManager();
  });

  it('saves and loads index', async () => {
    const indexPath = join(tmpDir, 'file_index.json');
    const index = { 'src/foo.ts': { hash: 'abc', last_indexed: '2026-01-01T00:00:00Z' } };
    await manager.save(indexPath, index);
    const loaded = await manager.load(indexPath);
    expect(loaded).toEqual(index);
  });

  it('returns empty object for missing index', async () => {
    const loaded = await manager.load(join(tmpDir, 'nonexistent.json'));
    expect(loaded).toEqual({});
  });

  it('detects changed file hashes', async () => {
    const filePath = join(tmpDir, 'test.ts');
    await writeFile(filePath, 'const x = 1;');
    const hash1 = await manager.hashFile(filePath);

    await writeFile(filePath, 'const x = 2;');
    const hash2 = await manager.hashFile(filePath);

    expect(hash1).not.toBe(hash2);
  });

  it('identifies new files as changed', async () => {
    const filePath = join(tmpDir, 'new.ts');
    await writeFile(filePath, 'export const x = 1;');

    const discovered = [
      { path: 'new.ts', absolutePath: filePath, extension: '.ts', language: 'typescript' },
    ];
    const result = await manager.getChangedFiles(discovered, {});
    expect(result.changed.map(f => f.path)).toContain('new.ts');
    expect(result.deleted).toHaveLength(0);
  });

  it('identifies deleted files', async () => {
    const currentIndex = {
      'deleted.ts': { hash: 'old_hash', last_indexed: '2026-01-01T00:00:00Z' },
    };
    const result = await manager.getChangedFiles([], currentIndex);
    expect(result.deleted).toContain('deleted.ts');
    expect(result.changed).toHaveLength(0);
  });

  it('skips unchanged files', async () => {
    const filePath = join(tmpDir, 'unchanged.ts');
    await writeFile(filePath, 'const x = 1;');
    const hash = await manager.hashFile(filePath);

    const discovered = [
      { path: 'unchanged.ts', absolutePath: filePath, extension: '.ts', language: 'typescript' },
    ];
    const currentIndex = {
      'unchanged.ts': { hash, last_indexed: '2026-01-01T00:00:00Z' },
    };

    const result = await manager.getChangedFiles(discovered, currentIndex);
    expect(result.changed).toHaveLength(0);
    expect(result.deleted).toHaveLength(0);
  });
});
