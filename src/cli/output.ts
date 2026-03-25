/**
 * CLI output formatting helpers.
 *
 * Centralises all console output so that formatting (colours, prefixes)
 * is consistent and can be changed in one place.
 */

import chalk from 'chalk';
import type { IndexResult } from '../indexer/indexer.js';

export function printHeader(text: string): void {
  console.log(chalk.bold.cyan(`\n${text}\n`));
}

export function printSuccess(text: string): void {
  console.log(chalk.green(`✓ ${text}`));
}

export function printError(text: string): void {
  console.log(chalk.red(`✗ ${text}`));
}

export function printWarning(text: string): void {
  console.log(chalk.yellow(`⚠ ${text}`));
}

export function printSummary(result: IndexResult): void {
  console.log(chalk.bold('\nIndex Summary'));
  console.log(`  Files discovered: ${result.filesDiscovered}`);
  console.log(`  Files indexed:    ${result.filesIndexed}`);
  console.log(`  Files skipped:    ${result.filesSkipped}`);
  console.log(`  Files deleted:    ${result.filesDeleted}`);
  console.log(`  Entities created: ${result.entitiesCreated}`);
  console.log(`  Relations created: ${result.relationsCreated}`);
  console.log(`  Duration:         ${result.duration}ms`);

  if (Object.keys(result.languageCounts).length > 0) {
    console.log(chalk.bold('\nLanguages'));
    for (const [lang, count] of Object.entries(result.languageCounts).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${lang}: ${count} files`);
    }
  }

  if (result.errors.length > 0) {
    console.log(chalk.yellow(`\n${result.errors.length} errors during indexing`));
    for (const err of result.errors.slice(0, 5)) {
      console.log(chalk.yellow(`  ${err.file}: ${err.message}`));
    }
    if (result.errors.length > 5) {
      console.log(chalk.yellow(`  ... and ${result.errors.length - 5} more`));
    }
  }
}
