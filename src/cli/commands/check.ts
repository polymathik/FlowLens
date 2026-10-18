/**
 * `flowlens check`
 *
 * Run architecture validation and cycle detection against the indexed graph.
 * Exits with code 1 when issues are found, 2 on error, 0 when clean.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openGraphStore } from '../../service/open-graph-store.js';
import { detectCycles } from '../../analysis/cycle-detector.js';
import { validateArchitecture } from '../../analysis/architecture-validator.js';
import { printHeader, printError, printSuccess } from '../output.js';
import type { ArchitectureConfig } from '../../contracts/architecture.js';
import type { CycleSeverity } from '../../contracts/analysis/cycles.js';

export const checkCommand = new Command('check')
  .description('Run architecture validation and cycle detection')
  .option('--format <format>', 'Output format: text, json', 'text')
  .option('--cycles', 'Run cycle detection only')
  .option('--architecture', 'Run architecture validation only')
  .option('--severity <level>', 'Minimum severity: low, medium, high', 'low')
  .option('--scope <path>', 'Limit check to a subtree')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(2);
    }

    try {
      const graphStore = await openGraphStore(rootDir, { daemon: opts.daemon, client: 'check' });

      let cycleResults: Awaited<ReturnType<typeof detectCycles>> = [];
      let violations: Awaited<ReturnType<typeof validateArchitecture>> = [];
      const runCycles = !opts.architecture;
      const runArch = !opts.cycles;

      // Cycle detection
      if (runCycles) {
        cycleResults = await detectCycles(graphStore, {
          granularity: 'file',
          severity_threshold: opts.severity as CycleSeverity,
          scope: opts.scope,
        });
      }

      // Architecture validation
      if (runArch) {
        const archPath = join(flowlensDir, 'architecture.json');
        if (existsSync(archPath)) {
          const archConfig: ArchitectureConfig = JSON.parse(
            await readFile(archPath, 'utf-8'),
          );
          violations = await validateArchitecture(graphStore, archConfig);
        }
      }

      await graphStore.close();

      const hasIssues = cycleResults.length > 0 || violations.length > 0;

      if (opts.format === 'json') {
        const output = {
          timestamp: new Date().toISOString(),
          cycles: cycleResults.map((c) => ({
            entities: c.entities,
            severity: c.severity,
            granularity: c.granularity,
          })),
          architecture_violations: violations.map((v) => ({
            rule: v.rule,
            from: v.entity_from,
            to: v.entity_to,
            suggestion: v.auto_fix_suggestion,
          })),
          summary: {
            cycles_found: cycleResults.length,
            violations_found: violations.length,
            severity_breakdown: {
              high: cycleResults.filter((c) => c.severity === 'high').length,
              medium: cycleResults.filter((c) => c.severity === 'medium').length,
              low: cycleResults.filter((c) => c.severity === 'low').length,
            },
          },
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        printHeader('FlowLens Check');

        if (runCycles) {
          if (cycleResults.length === 0) {
            printSuccess('No circular dependencies detected');
          } else {
            console.log(`\n${cycleResults.length} circular dependencies found:`);
            for (const cycle of cycleResults) {
              console.log(
                `  [${cycle.severity}] ${cycle.entities.join(' → ')} → ${cycle.entities[0]}`,
              );
            }
          }
        }

        if (runArch) {
          if (violations.length === 0) {
            printSuccess('No architecture violations');
          } else {
            console.log(`\n${violations.length} architecture violations found:`);
            for (const v of violations) {
              console.log(`  ${v.rule}`);
              if (v.auto_fix_suggestion)
                console.log(`    → ${v.auto_fix_suggestion}`);
            }
          }
        }
      }

      process.exit(hasIssues ? 1 : 0);
    } catch (err) {
      printError(
        `Check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(2);
    }
  });
