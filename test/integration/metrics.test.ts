import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runIndex } from '../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../src/graph/levelgraph-store.js';
import type { FlowLensConfig } from '../../src/contracts/config.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

describe('Metrics integration', () => {
  let tmpDir: string;
  let store: LevelGraphStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'flowlens-metrics-'));
    store = new LevelGraphStore();
    await store.open(join(tmpDir, 'graph'));
  });

  afterEach(async () => {
    await store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('populates metrics on function entities after indexing', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/metrics-reference'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const functions = await store.getNodesByKind('function');
    expect(functions.length).toBeGreaterThan(0);

    // Check trivial function: cognitive=0, cyclomatic=1
    const trivial = functions.find(f => f.name === 'trivial');
    expect(trivial).toBeDefined();
    expect(trivial!.metrics).toBeDefined();
    expect(trivial!.metrics!.cognitive_complexity).toBe(0);
    expect(trivial!.metrics!.cyclomatic_complexity).toBe(1);
    expect(trivial!.metrics!.quality_score).toBeDefined();
    expect(trivial!.metrics!.quality_score).toBeGreaterThan(0);

    // Check simpleIf: cognitive=1, cyclomatic=2
    const simpleIf = functions.find(f => f.name === 'simpleIf');
    expect(simpleIf).toBeDefined();
    expect(simpleIf!.metrics!.cognitive_complexity).toBe(1);
    expect(simpleIf!.metrics!.cyclomatic_complexity).toBe(2);

    // Check spec example: cognitive=7
    const specExample = functions.find(f => f.name === 'specExample');
    expect(specExample).toBeDefined();
    expect(specExample!.metrics!.cognitive_complexity).toBe(7);
    expect(specExample!.metrics!.halstead_volume).toBeGreaterThan(0);
    expect(specExample!.metrics!.halstead_bugs).toBeGreaterThan(0);
  });

  it('deepNesting has higher cognitive complexity than specExample', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/metrics-reference'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const functions = await store.getNodesByKind('function');
    const specExample = functions.find(f => f.name === 'specExample')!;
    const deepNesting = functions.find(f => f.name === 'deepNesting')!;

    expect(deepNesting.metrics!.cognitive_complexity).toBeGreaterThan(
      specExample.metrics!.cognitive_complexity!,
    );
  });

  it('quality score decreases with complexity', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/metrics-reference'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const functions = await store.getNodesByKind('function');
    const trivial = functions.find(f => f.name === 'trivial')!;
    const deep = functions.find(f => f.name === 'deepNesting')!;

    expect(trivial.metrics!.quality_score).toBeDefined();
    expect(deep.metrics!.quality_score).toBeDefined();
    expect(trivial.metrics!.quality_score!).toBeGreaterThan(deep.metrics!.quality_score!);
  });

  it('Halstead metrics are populated for all functions', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/metrics-reference'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const functions = await store.getNodesByKind('function');
    for (const fn of functions) {
      expect(fn.metrics).toBeDefined();
      expect(fn.metrics!.halstead_volume).toBeGreaterThan(0);
      expect(fn.metrics!.halstead_difficulty).toBeGreaterThanOrEqual(0);
      expect(fn.metrics!.halstead_bugs).toBeGreaterThanOrEqual(0);
    }
  });

  it('line_count is set on all entities', async () => {
    await runIndex({
      rootDir: join(import.meta.dirname, '../fixtures/simple-project'),
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });

    const allClasses = await store.getNodesByKind('class');
    for (const cls of allClasses) {
      expect(cls.metrics).toBeDefined();
      expect(cls.metrics!.line_count).toBeGreaterThan(0);
    }

    const allFunctions = await store.getNodesByKind('function');
    for (const fn of allFunctions) {
      expect(fn.metrics).toBeDefined();
      expect(fn.metrics!.line_count).toBeGreaterThan(0);
    }
  });

  it('metrics computation completes within performance budget', async () => {
    const fixtureDir = join(import.meta.dirname, '../fixtures/simple-project');

    const start = performance.now();
    await runIndex({
      rootDir: fixtureDir,
      graphStore: store,
      config: DEFAULT_CONFIG,
      fileIndexPath: join(tmpDir, 'file_index.json'),
      incremental: false,
    });
    const duration = performance.now() - start;

    // Indexing a small project should complete well under 2 seconds even with metrics
    expect(duration).toBeLessThan(2000);
  });
});
