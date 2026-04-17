/**
 * Benchmark orchestrator — runs each benchmark, prints a pass/fail
 * summary against spec §5.1 targets.
 *
 * Usage:
 *   npx tsx benchmarks/run-all.ts         # default sizes (quick)
 *   npx tsx benchmarks/run-all.ts --full  # larger sizes (matches spec targets)
 *
 * Targets (from spec §5.1):
 *   Full index     : <30s for 10K files  → msPerFile <3ms
 *   Single re-index: <100ms              → meanSingleFileMs <100
 *   MCP query      : <50ms               → getContextP99Ms <50
 *   Canvas first render: <15s (not measured here — client-side)
 */
import { runIndexBenchmark } from './index-benchmark.js';
import { runQueryBenchmark } from './query-benchmark.js';
import { runWatchBenchmark } from './watch-benchmark.js';

interface BenchmarkLine {
  name: string;
  metric: string;
  value: number;
  target: string;
  pass: boolean;
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full');
  const sizes = full ? [10_000] : [500];
  const results: BenchmarkLine[] = [];

  for (const size of sizes) {
    console.log(`\n=== Index benchmark (${size} files) ===`);
    const idx = await runIndexBenchmark(size);
    console.log(JSON.stringify(idx, null, 2));
    results.push({
      name: 'index',
      metric: `${size}-file full index`,
      value: idx.durationMs,
      target: full ? '<30000 ms' : '<5000 ms',
      pass: full ? idx.durationMs < 30_000 : idx.durationMs < 5_000,
    });

    console.log(`\n=== Query benchmark (${size} files) ===`);
    const q = await runQueryBenchmark(size, full ? 100 : 30);
    console.log(JSON.stringify(q, null, 2));
    results.push({
      name: 'query',
      metric: 'get_context p99',
      value: q.getContextP99Ms,
      target: '<50 ms',
      pass: q.getContextP99Ms < 50,
    });

    console.log(`\n=== Watch benchmark (${size} files) ===`);
    const w = await runWatchBenchmark(size);
    console.log(JSON.stringify(w, null, 2));
    results.push({
      name: 'watch',
      metric: 'single-file re-index mean',
      value: w.meanSingleFileMs,
      target: '<100 ms',
      pass: w.meanSingleFileMs < 100,
    });
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    const mark = r.pass ? '✓' : '✗';
    console.log(`${mark} ${r.name}: ${r.metric} = ${r.value}ms (target ${r.target})`);
  }

  const failed = results.filter((r) => !r.pass).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
