/**
 * Index benchmark — measures time to run a full `flowlens index` against
 * a synthetic project of N files. Run directly:
 *
 *   npx tsx benchmarks/index-benchmark.ts [fileCount=1000]
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LevelGraphStore } from '../src/graph/levelgraph-store.js';
import { runIndex } from '../src/indexer/indexer.js';
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

export interface IndexBenchmarkResult {
  fileCount: number;
  durationMs: number;
  entitiesCreated: number;
  relationsCreated: number;
  /** ms per file — lower is better. */
  msPerFile: number;
}

export async function runIndexBenchmark(
  fileCount: number,
): Promise<IndexBenchmarkResult> {
  const rootDir = await mkdtemp(join(tmpdir(), 'flowlens-bench-'));
  try {
    await generateSyntheticProject({ rootDir, fileCount });

    const graphStore = new LevelGraphStore();
    await graphStore.open(join(rootDir, '.flowlens', 'graph'));

    const start = Date.now();
    const result = await runIndex({
      rootDir,
      graphStore,
      config: MINIMAL_CONFIG,
      fileIndexPath: join(rootDir, '.flowlens', 'file_index.json'),
      incremental: false,
    });
    const durationMs = Date.now() - start;
    await graphStore.close();

    return {
      fileCount,
      durationMs,
      entitiesCreated: result.entitiesCreated,
      relationsCreated: result.relationsCreated,
      msPerFile: durationMs / fileCount,
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

// Run if invoked directly (tsx benchmarks/index-benchmark.ts 1000)
if (import.meta.url === `file://${process.argv[1]}`) {
  const fileCount = parseInt(process.argv[2] ?? '1000', 10);
  runIndexBenchmark(fileCount).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
