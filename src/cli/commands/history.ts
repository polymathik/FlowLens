/**
 * `flowlens history build|show` — fill and inspect the repo-growth caches
 * (`.flowlens/history/`) that the Map's timeline reads. Works without the
 * daemon (plain git + the indexer's parser); the daemon serves whatever is cached.
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HistoryError, TOPOLOGY_DEFAULT_SAMPLES, TOPOLOGY_MAX_SAMPLES } from '../../contracts/history.js';
import { readCommitsCache, readTopologyCache } from '../../history/cache.js';
import { buildHistory, toSummary } from '../../history/commits.js';
import { describeHistory, describeTopology } from '../../history/describe.js';
import { loadFileFilter } from '../../history/file-filter.js';
import { buildTopology } from '../../history/topology.js';
import { loadProjectConfig } from '../../projects/config.js';
import { printError, printSuccess, printWarning } from '../output.js';

function positiveInt(name: string, raw: string | undefined, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    printError(`Invalid --${name} '${raw}' (1..${max})`);
    process.exit(2);
  }
  return n;
}

function requireProject(): { root: string; flowlensDir: string } {
  const root = resolve('.');
  const flowlensDir = join(root, '.flowlens');
  if (!existsSync(flowlensDir)) {
    printError('.flowlens/ not found. Run "flowlens init" first.');
    process.exit(2);
  }
  return { root, flowlensDir };
}

const build = new Command('build')
  .description('Read the git history (and optionally sample dependency topology) into .flowlens/history/')
  .option('--max <n>', 'Newest commits to keep (default 2000)')
  .option('--first-parent', 'List merges instead of the commits they bring in')
  .option('--topology', 'Also sample file-level dependency edges at a few commits (slow: parses each sampled tree)')
  .option('--every <n>', 'Topology: sample every n-th commit')
  .option('--samples <n>', `Topology: most samples (default ${TOPOLOGY_DEFAULT_SAMPLES}, up to ${TOPOLOGY_MAX_SAMPLES})`)
  .action(async (opts: { max?: string; firstParent?: boolean; topology?: boolean; every?: string; samples?: string }) => {
    const { root, flowlensDir } = requireProject();
    const max = positiveInt('max', opts.max, 20_000);
    const every = positiveInt('every', opts.every, 20_000);
    const samples = positiveInt('samples', opts.samples, TOPOLOGY_MAX_SAMPLES);
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    try {
      const filter = await loadFileFilter(root, loadProjectConfig(root));
      const h = await buildHistory({ rootDir: root, flowlensDir, filter, max, firstParent: opts.firstParent, signal: abort.signal });
      printSuccess(`${describeHistory(h)} [${h.build?.mode}, ${h.build?.duration_ms}ms]`);
      if (!opts.topology) return;
      const t = await buildTopology({
        rootDir: root, flowlensDir, filter, head: h.head, commits: h.commits, every, max: samples, signal: abort.signal,
        onProgress: (p) => process.stderr.write(`\r  topology ${p.done}/${p.total} (${p.reused} reused, ${p.skipped} skipped)   `),
      });
      process.stderr.write('\n');
      printSuccess(describeTopology(t));
      for (const s of t.skipped) printWarning(`skipped ${s.sha.slice(0, 7)}: ${s.reason}`);
    } catch (err) {
      process.stderr.write('\n');
      printError(err instanceof HistoryError ? `${err.message} (${err.code})` : `History failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(err instanceof HistoryError && err.code === 'aborted' ? 130 : 2);
    }
  });

const show = new Command('show')
  .description('One-line summary of the cached history and topology')
  .option('--json', 'Print the cached summary (without the commit list) as JSON')
  .action(async (opts: { json?: boolean }) => {
    const { flowlensDir } = requireProject();
    const cache = await readCommitsCache(flowlensDir);
    const topology = await readTopologyCache(flowlensDir);
    if (!cache) {
      printWarning('No history cached. Run "flowlens history build".');
      return;
    }
    const summary = toSummary(cache);
    if (opts.json) {
      console.log(JSON.stringify({ ...summary, commits: undefined, baseline: undefined, topology: topology && { samples: topology.samples.length, every: topology.every, capped: topology.capped, skipped: topology.skipped.length } }, null, 2));
      return;
    }
    console.log(describeHistory(summary));
    console.log(topology ? describeTopology(topology) : 'no topology samples (run "flowlens history build --topology")');
  });

export const historyCommand = new Command('history')
  .description('Repo growth over time: commit history and sampled dependency topology (for the Map timeline)')
  .addCommand(build)
  .addCommand(show);
