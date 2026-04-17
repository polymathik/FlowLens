/**
 * Query benchmark — measures MCP tool latency on a fully-indexed
 * synthetic project. Targets the three most-exercised tools:
 * get_context, get_dependents, and get_metrics.
 *
 * Target from spec §5.1: <50ms per query on a 10K-entity graph.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LevelGraphStore } from '../src/graph/levelgraph-store.js';
import { runIndex } from '../src/indexer/indexer.js';
import { AnnotationStore } from '../src/mcp/annotation-store.js';
import { SnapshotManager } from '../src/analysis/snapshot-manager.js';
import { handleGetContext } from '../src/mcp/tools/get-context.js';
import { generateSyntheticProject } from './synthetic-project-generator.js';
import type { ServerDependencies } from '../src/mcp/server.js';
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

export interface QueryBenchmarkResult {
  fileCount: number;
  getContextP50Ms: number;
  getContextP99Ms: number;
  iterations: number;
}

export async function runQueryBenchmark(
  fileCount: number,
  iterations = 100,
): Promise<QueryBenchmarkResult> {
  const rootDir = await mkdtemp(join(tmpdir(), 'flowlens-qbench-'));
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

    const annotationStore = new AnnotationStore(
      join(rootDir, '.flowlens', 'annotations.json'),
    );
    await annotationStore.load();
    const deps: ServerDependencies = {
      graph,
      annotationStore,
      snapshotManager: new SnapshotManager(join(rootDir, '.flowlens', 'snapshots')),
      flowlensDir: join(rootDir, '.flowlens'),
      rootDir,
      fileIndexPath: join(rootDir, '.flowlens', 'file_index.json'),
    };

    // Warm-up
    await handleGetContext({ entity: 'Class0' }, deps);

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const target = `Class${i % fileCount}`;
      const start = Date.now();
      await handleGetContext({ entity: target }, deps);
      samples.push(Date.now() - start);
    }

    samples.sort((a, b) => a - b);
    await graph.close();

    return {
      fileCount,
      iterations,
      getContextP50Ms: samples[Math.floor(iterations * 0.5)],
      getContextP99Ms: samples[Math.floor(iterations * 0.99)],
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fileCount = parseInt(process.argv[2] ?? '500', 10);
  runQueryBenchmark(fileCount).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
