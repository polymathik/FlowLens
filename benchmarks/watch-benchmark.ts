/**
 * Watch benchmark — measures single-file re-index latency after a change.
 * Target from spec §5.1: <100ms for a single file.
 *
 * Approach: build a synthetic project, do a full index, then change one
 * file and time how long `applyWatchEvents` takes to apply the update.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LevelGraphStore } from '../src/graph/levelgraph-store.js';
import { runIndex } from '../src/indexer/indexer.js';
import { applyWatchEvents } from '../src/watch/incremental-updater.js';
import { generateSyntheticProject } from './synthetic-project-generator.js';
import type { FlowLensConfig } from '../src/contracts/config.js';

const MINIMAL_CONFIG: FlowLensConfig = {
  exclude: ['node_modules/**', 'dist/**', '.flowlens/**', '.git/**'],
  languages: { typescript: true },
  ai: {
    enabled: false,
    provider: 'anthropic',
    model: '',
    api_key_env: 'ANTHROPIC_API_KEY',
  },
};

export interface WatchBenchmarkResult {
  fileCount: number;
  singleFileReindexMs: number;
  /** Mean over 10 runs. */
  meanSingleFileMs: number;
}

export async function runWatchBenchmark(
  fileCount: number,
): Promise<WatchBenchmarkResult> {
  const rootDir = await mkdtemp(join(tmpdir(), 'flowlens-wbench-'));
  try {
    await generateSyntheticProject({ rootDir, fileCount });

    const graph = new LevelGraphStore();
    await graph.open(join(rootDir, '.flowlens', 'graph'));
    await runIndex({
      rootDir,
      graphStore: graph,
      config: MINIMAL_CONFIG,
      fileIndexPath: join(rootDir, '.flowlens', 'file_index.json'),
      incremental: false,
    });

    // Change one file 10 times and measure re-index latency each time
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const path = `src/mod${i}.ts`;
      await writeFile(
        join(rootDir, path),
        `export class Class${i}V${i} {}\nexport function helper${i}(x: number) { return x + ${i}; }`,
      );
      const start = Date.now();
      await applyWatchEvents(
        [{ type: 'change', path, timestamp: Date.now() }],
        { rootDir, graph },
      );
      samples.push(Date.now() - start);
    }

    await graph.close();

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    return {
      fileCount,
      singleFileReindexMs: samples[0],
      meanSingleFileMs: Math.round(mean * 10) / 10,
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fileCount = parseInt(process.argv[2] ?? '500', 10);
  runWatchBenchmark(fileCount).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
