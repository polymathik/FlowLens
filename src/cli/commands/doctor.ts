/**
 * `flowlens doctor` — runs all diagnostic checks against the current
 * working directory and prints a pretty report. Exits with:
 *   0 — all ok (may include warnings)
 *   2 — any error-severity check failed
 *
 * Warnings don't fail the command: doctor is intentionally soft on
 * warnings so it works as a first-run bootstrapping check.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { runDoctor } from '../../doctor/doctor.js';
import type { DiagnosticCheck, OverallStatus } from '../../contracts/doctor.js';

export const doctorCommand = new Command('doctor')
  .description('Run diagnostic health checks on the current FlowLens setup')
  .option('--format <format>', 'Output format: text, json', 'text')
  .action(async (opts) => {
    const report = await runDoctor(resolve('.'));

    if (opts.format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report.checks);
      printFooter(report);
    }

    process.exit(report.overall === 'error' ? 2 : 0);
  });

function printReport(checks: DiagnosticCheck[]): void {
  console.log(chalk.bold.cyan('\nFlowLens Doctor\n'));
  for (const check of checks) {
    const glyph = pickGlyph(check.status);
    console.log(`${glyph} ${check.title}: ${check.message}`);
    if (check.details) {
      console.log(chalk.gray(`    → ${check.details}`));
    }
  }
}

function printFooter(report: {
  overall: OverallStatus;
  checks: DiagnosticCheck[];
}): void {
  const warns = report.checks.filter((c) => c.status === 'warning').length;
  const errors = report.checks.filter((c) => c.status === 'error').length;
  let overall: string;
  if (report.overall === 'error') {
    overall = chalk.red(`FAIL (${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'})`);
  } else if (report.overall === 'warning') {
    overall = chalk.yellow(`OK with ${warns} warning${warns === 1 ? '' : 's'}`);
  } else {
    overall = chalk.green('OK');
  }
  console.log(`\nOverall: ${overall}`);
}

function pickGlyph(status: DiagnosticCheck['status']): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warning') return chalk.yellow('⚠');
  if (status === 'skipped') return chalk.gray('–');
  return chalk.red('✗');
}
