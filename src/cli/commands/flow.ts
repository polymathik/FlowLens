/**
 * `flowlens flow <entity>` — "what happens when X runs?" as an indented tree
 * in the terminal. `<entity>` is an entry-point label ('GET /api/users',
 * 'cli: start'), a qualified name, a file path or a unique name. `--in`
 * answers "what triggers X?"; `--list` prints the project's entry points.
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENTRY_POINT_KINDS, FLOW_LIMITS, type EntryPointKind } from '../../contracts/flow.js';
import { buildFlowContext } from '../../flow/context.js';
import { queryEntryPoints, queryTrace } from '../../flow/queries.js';
import { renderEntryPointsText, renderTraceText } from '../../flow/render.js';
import { openGraphStore } from '../../service/open-graph-store.js';
import { printError } from '../output.js';

function intOption(name: string, raw: string | undefined, min: number, max: number): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) {
    printError(`Invalid --${name} '${raw}' (${min}..${max})`);
    process.exit(2);
  }
  return n;
}

interface FlowOptions {
  list?: boolean;
  in?: boolean;
  depth?: string;
  maxNodes?: string;
  kind?: string;
  tests?: boolean;
  json?: boolean;
  daemon?: boolean;
}

export const flowCommand = new Command('flow')
  .description('Trace what happens when an entry point or function runs (calls, depth-limited), as a text tree')
  .argument('[entity]', "Entry-point label ('GET /api/users'), qualified name, file path or unique name")
  .option('--list', 'List the project\'s entry points instead of tracing')
  .option('--in', 'Trace backwards: what triggers this (callers up to entry points)')
  .option('--depth <n>', `Depth (default ${FLOW_LIMITS.depth.default}, max ${FLOW_LIMITS.depth.cap})`)
  .option('--max-nodes <n>', `Most nodes to show (default ${FLOW_LIMITS.maxNodes.default})`)
  .option('--kind <kinds>', `With --list: comma-separated kinds (${ENTRY_POINT_KINDS.join(', ')})`)
  .option('--tests', 'Include test entry points / follow into tests')
  .option('--json', 'Print the raw JSON instead of the tree')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (entity: string | undefined, opts: FlowOptions) => {
    const rootDir = resolve('.');
    if (!existsSync(join(rootDir, '.flowlens'))) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(2);
    }
    if (!opts.list && !entity) {
      printError('Give an entity to trace, or use --list to see the entry points.');
      process.exit(2);
    }
    const kinds = opts.kind?.split(',').map((k) => k.trim()).filter(Boolean);
    const badKind = kinds?.find((k) => !(ENTRY_POINT_KINDS as readonly string[]).includes(k));
    if (badKind) {
      printError(`Unknown --kind '${badKind}' (one of ${ENTRY_POINT_KINDS.join(', ')})`);
      process.exit(2);
    }
    const depth = intOption('depth', opts.depth, 1, FLOW_LIMITS.depth.cap);
    const maxNodes = intOption('max-nodes', opts.maxNodes, 1, FLOW_LIMITS.maxNodes.cap);

    const store = await openGraphStore(rootDir, { daemon: opts.daemon, client: 'flow' });
    try {
      const ctx = await buildFlowContext(store, rootDir);
      if (opts.list) {
        const { result, total } = queryEntryPoints(ctx, { kind: kinds as EntryPointKind[] | undefined, include_tests: opts.tests });
        console.log(opts.json ? JSON.stringify(result, null, 2) : renderEntryPointsText(result.entry_points, result.counts_by_kind) + (result.entry_points.length < total ? `\n(${total - result.entry_points.length} more)` : ''));
        return;
      }
      const out = queryTrace(ctx, { entity: entity as string, depth, max_nodes: maxNodes, direction: opts.in ? 'in' : 'out', include_tests: opts.tests });
      if (!out.ok) {
        printError(out.error.error.message);
        for (const s of out.error.suggestions ?? []) console.error(`  ${s}`);
        process.exitCode = out.error.error.code === 'bad_request' ? 2 : 1;
        return;
      }
      console.log(opts.json ? JSON.stringify(out.trace, null, 2) : renderTraceText(out.trace));
    } catch (err) {
      printError(`Flow failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    } finally {
      await store.close();
    }
  });
