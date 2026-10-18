/**
 * `flowlens check`
 *
 * Run architecture validation and cycle detection against the indexed graph.
 * Exit codes: 0 clean, 1 issues found, 2 usage/config error (bad flags, or a
 * missing/invalid architecture.json when architecture validation runs).
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openGraphStore } from '../../service/open-graph-store.js';
import { runCheck } from '../../analysis/check-runner.js';
import { printHeader, printError, printSuccess } from '../output.js';
import { CYCLE_SEVERITIES, type CycleSeverity } from '../../contracts/analysis/cycles.js';
import { CHECK_EXIT, type CheckReport } from '../../contracts/analysis/check.js';

export const checkCommand = new Command('check')
  .description('Run architecture validation and cycle detection')
  .option('--format <format>', 'Output format: text, json', 'text')
  .option('--cycles', 'Run cycle detection (only, unless --architecture is also given)')
  .option('--architecture', 'Run architecture validation (only, unless --cycles is also given)')
  .option('--severity <level>', 'Minimum cycle severity: low, medium, high', 'low')
  .option('--scope <path>', 'Limit check to a subtree')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (opts) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (!existsSync(flowlensDir)) {
      printError('.flowlens/ not found. Run "flowlens init" first.');
      process.exit(CHECK_EXIT.error);
    }
    if (!CYCLE_SEVERITIES.includes(opts.severity)) {
      printError(`Invalid --severity '${opts.severity}'. Use one of: ${CYCLE_SEVERITIES.join(', ')}`);
      process.exit(CHECK_EXIT.error);
    }
    if (opts.format !== 'text' && opts.format !== 'json') {
      printError(`Invalid --format '${opts.format}'. Use text or json`);
      process.exit(CHECK_EXIT.error);
    }
    const both = !opts.cycles && !opts.architecture;

    try {
      const graphStore = await openGraphStore(rootDir, { daemon: opts.daemon, client: 'check' });

      const { report, exitCode, problems } = await runCheck(graphStore, {
        flowlensDir,
        runCycles: both || Boolean(opts.cycles),
        runArchitecture: both || Boolean(opts.architecture),
        severity: opts.severity as CycleSeverity,
        scope: opts.scope,
      });

      await graphStore.close();

      if (opts.format === 'json') {
        console.log(JSON.stringify({ ...report, problems }, null, 2));
      } else {
        printText(report, problems, both || Boolean(opts.cycles), both || Boolean(opts.architecture));
      }
      process.exit(exitCode);
    } catch (err) {
      printError(`Check failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(CHECK_EXIT.error);
    }
  });

function printText(report: CheckReport, problems: string[], cycles: boolean, arch: boolean): void {
  printHeader('FlowLens Check');
  if (cycles) {
    if (report.cycles.length === 0) {
      printSuccess(`No circular dependencies detected (severity ≥ ${report.severity_threshold})`);
    } else {
      console.log(`\n${report.cycles.length} circular dependencies found:`);
      for (const c of report.cycles) {
        console.log(`  [${c.severity}] ${c.path.join(' → ')}`);
        if (c.severity_reasons.length > 0) console.log(`      ${c.severity_reasons.join('; ')}`);
      }
    }
  }
  if (arch) {
    for (const p of problems) printError(p);
    if (report.architecture === 'checked') {
      if (report.architecture_violations.length === 0) {
        printSuccess('No architecture violations');
      } else {
        console.log(`\n${report.architecture_violations.length} architecture violations found:`);
        for (const v of report.architecture_violations) {
          console.log(`  ${v.rule_text}`);
          console.log(`    ${v.from} → ${v.to} (${v.relation_type}, ${v.location})`);
          if (v.suggestion) console.log(`    → ${v.suggestion}`);
        }
      }
    }
  }
}
