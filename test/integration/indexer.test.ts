import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: {
    typescript: true, javascript: true, tsx: true, jsx: true,
    python: true, go: true, rust: true, java: true,
    kotlin: true, c: true, cpp: true, css: true, html: true, json: true,
  },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('Indexer integration', () => {
  let tmpDir: string;
  let store: LevelGraphStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-int-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('indexes simple-project and creates entities + relations', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: [] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    expect(result.filesIndexed).toBeGreaterThan(0);
    expect(result.entitiesCreated).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    // Verify entities in graph
    const classes = await store.getNodesByKind('class');
    expect(classes.length).toBeGreaterThan(0);
    expect(classes.find(c => c.name === 'UserService')).toBeDefined();

    const functions = await store.getNodesByKind('function');
    expect(functions.length).toBeGreaterThan(0);

    const interfaces = await store.getNodesByKind('interface');
    expect(interfaces.length).toBeGreaterThan(0);

    const enums = await store.getNodesByKind('enum');
    expect(enums.length).toBeGreaterThan(0);

    // Verify file entities
    const files = await store.getNodesByKind('file');
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('creates import relations between files', async () => {
    const rootDir = join(import.meta.dirname, '../fixtures/simple-project');
    await runIndex({
      rootDir,
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: [] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    // index.ts imports from user-service, utils, types
    const files = await store.getNodesByKind('file');
    const indexFile = files.find(f => f.name === 'index.ts');
    expect(indexFile).toBeDefined();

    if (indexFile) {
      const edges = await store.getEdgesFrom(indexFile.id, 'import');
      expect(edges.length).toBeGreaterThan(0);
    }
  });

  it('indexes multi-language project with file entities for all', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/multi-language'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: ['ignored/**'] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const fileEntities = await store.getNodesByKind('file');
    const languages = new Set(fileEntities.map(e => e.language));
    expect(languages.has('typescript')).toBe(true);
    expect(languages.has('python')).toBe(true);
    expect(languages.has('go')).toBe(true);
    expect(languages.has('java')).toBe(true);
    expect(languages.has('kotlin')).toBe(true);
    expect(languages.has('c')).toBe(true);
    expect(languages.has('cpp')).toBe(true);

    // Verify per-language counts
    expect(result.languageCounts['typescript']).toBeGreaterThan(0);
  });

  it('indexes flat project with no directory structure', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/flat-project'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: [] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    expect(result.filesIndexed).toBeGreaterThan(0);
    const files = await store.getNodesByKind('file');
    expect(files.find(f => f.name === 'app.ts')).toBeDefined();
    expect(files.find(f => f.name === 'helpers.ts')).toBeDefined();
  });

  it('indexes mixed CJS/ESM modules', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/mixed-modules'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: [] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    expect(result.filesIndexed).toBeGreaterThan(0);
    const files = await store.getNodesByKind('file');
    const languages = files.map(f => f.language);
    expect(languages).toContain('javascript'); // .mjs, .cjs
    expect(languages).toContain('typescript'); // .ts
  });

  it('handles broken syntax gracefully', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/broken-syntax'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: [] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    // Should not throw, should still create file entities
    expect(result.filesIndexed).toBeGreaterThan(0);
    const fileEntities = await store.getNodesByKind('file');
    expect(fileEntities.length).toBeGreaterThan(0);
  });

  it('performs incremental re-indexing (no changes)', async () => {
    const fixtureDir = join(import.meta.dirname, '../fixtures/simple-project');
    const indexPath = join(tmpDir, 'file_index.json');
    const config = { ...DEFAULT_CONFIG, exclude: [] };

    // First full index
    const result1 = await runIndex({
      rootDir: fixtureDir,
      graphStore: store,
      config,
      fileIndexPath: indexPath,
      incremental: false,
    });

    // Second incremental index (no changes)
    const result2 = await runIndex({
      rootDir: fixtureDir,
      graphStore: store,
      config,
      fileIndexPath: indexPath,
      incremental: true,
    });

    expect(result2.filesSkipped).toBe(result1.filesIndexed);
    expect(result2.filesIndexed).toBe(0);
  });

  it('respects exclude patterns', async () => {
    const result = await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/multi-language'),
      graphStore: store,
      config: { ...DEFAULT_CONFIG, exclude: ['ignored/**'] },
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const files = await store.getNodesByKind('file');
    const fileNames = files.map(f => f.name);
    expect(fileNames).not.toContain('skip.ts');
  });
});
