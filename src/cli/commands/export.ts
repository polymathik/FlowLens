/**
 * `flowlens export` — render the indexed graph in JSON / DOT / Mermaid
 * formats for sharing, external tooling, or embedding in docs.
 */
import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LevelGraphStore } from '../../graph/levelgraph-store.js';
import { renderExport } from '../../export/index.js';
import { writeFully } from '../../export/stream-writer.js';
import { printError } from '../output.js';
import type { ExportFormat, ExportOptions } from '../../contracts/export.js';
import type { RelationType } from '../../contracts/relations.js';

const VALID_FORMATS: ExportFormat[] = ['json', 'dot', 'mermaid'];

export const exportCommand = new Command('export')
  .description('Export the graph in JSON, DOT, or Mermaid format')
  .option('--format <format>', 'Output format: json, dot, mermaid', 'json')
  .option('--scope <path>', 'Limit to files under this path')
  .option('--relations <types>', 'Comma-separated relation types to include')
  .option('--metrics', 'Include metrics in JSON output (default: true)')
  .option('--no-metrics', 'Strip metrics from JSON output')
  .option('--output <file>', 'Write to file (default: stdout)')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(2);
    }

    const format = opts.format as ExportFormat;
    if (!VALID_FORMATS.includes(format)) {
      printError(`Unknown format "${format}". Use one of: ${VALID_FORMATS.join(', ')}`);
      process.exit(2);
    }

    try {
      const graphStore = new LevelGraphStore();
      await graphStore.open(join(flowlensDir, 'graph'));
      const entities = await graphStore.getAllNodes();
      const relations = await graphStore.getAllEdges();
      await graphStore.close();

      const exportOpts: ExportOptions = {
        format,
        scope: opts.scope,
        relation_types: opts.relations
          ? (String(opts.relations).split(',').map((s) => s.trim()) as RelationType[])
          : undefined,
        include_metrics: opts.metrics !== false,
        output: opts.output,
      };

      const result = renderExport(entities, relations, exportOpts);
      for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);

      if (opts.output) {
        await writeFile(opts.output, result.output, 'utf-8');
      } else {
        // Wait for the pipe to drain; never process.exit() with data pending.
        await writeFully(process.stdout, result.output);
      }
      process.exitCode = 0;
    } catch (err) {
      printError(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  });
