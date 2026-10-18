/** Run `git log` for history and return parsed, filtered commits (newest first). */
import { HISTORY_DEFAULT_MAX_BYTES, HISTORY_DEFAULT_TIMEOUT_MS, type HistoryCommit } from '../contracts/history.js';
import { toCommit } from './changes.js';
import { streamGit } from './git-run.js';
import { LOG_FORMAT, LogParser, type RawCommit } from './log-parser.js';

export interface ReadLogOptions {
  rootDir: string;
  /** Commit-ish whose history to read (a full sha). */
  head: string;
  /** Exclude everything reachable from this (incremental reads). */
  since?: string;
  /** Stop after this many commits. */
  limit?: number;
  firstParent?: boolean;
  /** Project root is below the repository top: only commits touching it. */
  scoped?: boolean;
  accepts: (path: string) => boolean;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface ReadLogResult {
  /** Newest first. */
  commits: HistoryCommit[];
  /** Git was stopped by the byte or time cap: older commits are missing. */
  stopped: boolean;
}

export function logArgs(o: Pick<ReadLogOptions, 'head' | 'since' | 'limit' | 'firstParent' | 'scoped'>): string[] {
  return [
    'log', '-z', LOG_FORMAT, '--raw', '--numstat', '-M', '--relative', '--no-color', '--no-ext-diff', '--no-textconv',
    ...(o.firstParent ? ['-m', '--first-parent'] : ['--no-merges']),
    ...(o.limit ? ['-n', String(o.limit)] : []),
    o.since ? `${o.since}..${o.head}` : o.head,
    ...(o.scoped ? ['--', '.'] : []),
  ];
}

export async function readLog(o: ReadLogOptions): Promise<ReadLogResult> {
  const commits: HistoryCommit[] = [];
  const parser = new LogParser((raw: RawCommit) => commits.push(toCommit(raw, o.accepts)));
  const res = await streamGit(logArgs(o), o.rootDir, (t) => parser.push(t), {
    signal: o.signal, maxBytes: o.maxBytes ?? HISTORY_DEFAULT_MAX_BYTES, timeoutMs: o.timeoutMs ?? HISTORY_DEFAULT_TIMEOUT_MS,
  });
  parser.end(!res.stopped);
  return { commits, stopped: res.stopped !== undefined };
}
