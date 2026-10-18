/**
 * Doctor orchestrator — runs all diagnostic checks and assembles a report.
 *
 * Runs checks sequentially (not in parallel) because:
 *   1. Output order is deterministic → easier to test
 *   2. File-index check is the slowest and doesn't benefit from parallelism
 *   3. LevelGraph opens can conflict under concurrent access
 *
 * Each check is independent and idempotent; runner wraps any throw into an
 * `error` status so a single check failure doesn't abort the whole report.
 */
import { join, resolve } from 'node:path';
import type {
  Doctor,
  DoctorContext,
  DoctorReport,
  DiagnosticCheck,
  OverallStatus,
  DiagnosticRunner,
} from '../contracts/doctor.js';
import { ALL_CHECKS } from './checks/index.js';

export interface DoctorOptions {
  /** Which check runners to execute. Defaults to ALL_CHECKS. */
  checks?: DiagnosticRunner[];
}

export class DefaultDoctor implements Doctor {
  private readonly runners: DiagnosticRunner[];

  constructor(options: DoctorOptions = {}) {
    this.runners = options.checks ?? ALL_CHECKS;
  }

  async diagnose(rootDir: string): Promise<DoctorReport> {
    const abs = resolve(rootDir);
    const ctx: DoctorContext = {
      rootDir: abs,
      flowlensDir: join(abs, '.flowlens'),
    };

    const results: DiagnosticCheck[] = [];
    for (const runner of this.runners) {
      results.push(await safeRun(runner, ctx));
    }

    return {
      checks: results,
      overall: rollUp(results),
      timestamp: new Date().toISOString(),
    };
  }
}

async function safeRun(
  runner: DiagnosticRunner,
  ctx: DoctorContext,
): Promise<DiagnosticCheck> {
  try {
    return await runner(ctx);
  } catch (err) {
    return {
      name: runner.name || 'unknown-check',
      title: runner.name || 'unknown check',
      status: 'error',
      message: `check threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function rollUp(results: DiagnosticCheck[]): OverallStatus {
  if (results.some((r) => r.status === 'error')) return 'error';
  if (results.some((r) => r.status === 'warning')) return 'warning';
  return 'ok';
}

/** Convenience for callers that don't want to instantiate the class. */
export async function runDoctor(rootDir: string): Promise<DoctorReport> {
  return new DefaultDoctor().diagnose(rootDir);
}
