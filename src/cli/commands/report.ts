/**
 * `flowlens report` — plain-English codebase health check-up.
 *
 *   flowlens report                      Markdown to stdout
 *   flowlens report --format html --out health.html
 *   flowlens report --format json --top 5
 *
 * Exit codes: 0 always when a graph exists (findings are not failures —
 * use `flowlens check` for CI gating); 2 when there is no graph or the
 * options are invalid. Output is written with a flush callback and the
 * process exits naturally, so piped stdout is never truncated.
 */
import { readDaemonInfo } from '../../service/daemon-info.js';
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HealthGraphMissingError,
  buildHealthReport,
  loadHealthInput,
  renderHealth,
  type HealthFormat,
} from '../../health/index.js';

const FORMATS: HealthFormat[] = ['md', 'html', 'json'];

export interface ReportOptions {
  format?: string;
  out?: string;
  top?: string | number;
  churnDays?: string | number;
  git?: boolean;
  /** commander's `--no-daemon` → false. */
  daemon?: boolean;
}

export interface ReportResult {
  exitCode: number;
  /** Rendered report (empty on error). */
  output: string;
  /** Message for stderr (errors, "wrote file" notes). */
  message?: string;
}

export async function runReport(rootDir: string, opts: ReportOptions): Promise<ReportResult> {
  const format = (opts.format ?? 'md').toLowerCase() as HealthFormat;
  if (!FORMATS.includes(format)) {
    return { exitCode: 2, output: '', message: `Unknown format "${opts.format}". Use one of: ${FORMATS.join(', ')}.` };
  }
  const top = parsePositive(opts.top, 10);
  const churnDays = parsePositive(opts.churnDays, 90);
  if (top === null || churnDays === null) {
    return { exitCode: 2, output: '', message: '--top and --churn-days must be positive whole numbers.' };
  }
  try {
    const input = await loadHealthInput(rootDir, { churnDays, noGit: opts.git === false, daemon: opts.daemon });
    const report = await buildHealthReport(input, { top, canvas_base_url: runningExplorerUrl() });
    const output = renderHealth(report, format);
    if (opts.out) {
      await writeFile(resolve(rootDir, opts.out), output, 'utf8');
      return { exitCode: 0, output, message: `Health report (grade ${report.grade}, ${report.score}/100) written to ${opts.out}` };
    }
    return { exitCode: 0, output };
  } catch (err) {
    if (err instanceof HealthGraphMissingError) {
      return {
        exitCode: 2,
        output: '',
        message:
          'No FlowLens map found for this folder.\n' +
          'Run "flowlens init" here first (it builds the map), then "flowlens report" again.',
      };
    }
    return { exitCode: 2, output: '', message: `Report failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function parsePositive(v: string | number | undefined, fallback: number): number | null {
  if (v === undefined) return fallback;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function write(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((done) => (text ? stream.write(text, () => done()) : done()));
}

export const reportCommand = new Command('report')
  .description('Plain-English health check-up: grade, top risks, and fix prompts for your AI assistant')
  .option('--format <format>', 'Output format: md, html, json', 'md')
  .option('--out <file>', 'Write to a file instead of stdout')
  .option('--top <n>', 'Show only the top N findings', '10')
  .option('--churn-days <n>', 'Days of git history to use for change risk', '90')
  .option('--no-git', 'Ignore git history')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (opts: ReportOptions) => {
    const result = await runReport(process.cwd(), opts);
    if (!opts.out || result.exitCode !== 0) await write(process.stdout, result.output);
    if (result.message) await write(process.stderr, `${result.message}\n`);
    process.exitCode = result.exitCode;
  });

/** "Show on map" links point at the running daemon's explorer when there is one. */
function runningExplorerUrl(): string | undefined {
  if (process.env.FLOWLENS_CANVAS_URL) return undefined;
  const port = readDaemonInfo()?.port;
  return port ? `http://127.0.0.1:${port}` : undefined;
}
