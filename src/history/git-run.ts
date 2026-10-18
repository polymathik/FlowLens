/**
 * Running git for history: streamed output with a byte cap and a time limit,
 * one-shot text commands, and error mapping to `HistoryError`.
 *
 * No shell is involved (arguments go straight to `spawn`), refs are never
 * taken from user input, and the environment is pinned so a user's git
 * config (signature display, pagers, colours, optional locks) cannot change
 * the output format.
 */
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { HistoryError } from '../contracts/history.js';

/** Config flags that make `git log` output parseable whatever the user's config says. */
export const GIT_SAFE_FLAGS = ['-c', 'core.quotepath=false', '-c', 'log.showSignature=false', '-c', 'diff.renames=true', '-c', 'core.pager=cat'];

export function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Stop (and report `stopped: 'bytes'`) once this much output was produced. */
  maxBytes?: number;
  /** Stop (and report `stopped: 'timeout'`) after this long. */
  timeoutMs?: number;
}

export interface StreamResult {
  /** Why we stopped git early; undefined when it ran to completion. */
  stopped?: 'bytes' | 'timeout';
}

/** Map git's stderr / spawn errors to typed errors. */
export function toHistoryError(stderr: string, err?: NodeJS.ErrnoException): HistoryError {
  if (err?.code === 'ENOENT') return new HistoryError('git_unavailable', 'git is not installed or not on PATH');
  if (/not a git repository/i.test(stderr)) return new HistoryError('not_a_git_repo', 'This project is not inside a git repository');
  if (/does not have any commits yet|unknown revision or path|bad default revision|ambiguous argument 'HEAD'/i.test(stderr)) {
    return new HistoryError('no_commits', 'This repository has no commits yet');
  }
  return new HistoryError('git_failed', stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'git failed');
}

/**
 * Run git and hand stdout to `onText` as decoded text chunks (multi-byte
 * characters are never split). Resolves when git exits or was stopped by a
 * cap; rejects with a `HistoryError` on failure or abort.
 */
export function streamGit(args: string[], cwd: string, onText: (chunk: string) => void, o: StreamOptions = {}): Promise<StreamResult> {
  return new Promise((resolve, reject) => {
    if (o.signal?.aborted) return reject(new HistoryError('aborted', 'History build was cancelled'));
    const child = spawn('git', [...GIT_SAFE_FLAGS, ...args], { cwd, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8');
    let stderr = '';
    let bytes = 0;
    let stopped: StreamResult['stopped'];
    let settled = false;

    const stop = (why: 'bytes' | 'timeout'): void => {
      if (stopped) return;
      stopped = why;
      child.kill('SIGKILL');
    };
    const timer = o.timeoutMs ? setTimeout(() => stop('timeout'), o.timeoutMs) : undefined;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new HistoryError('aborted', 'History build was cancelled'));
    };
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
    };
    o.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (buf: Buffer) => {
      if (stopped || settled) return;
      bytes += buf.length;
      onText(decoder.write(buf));
      if (o.maxBytes !== undefined && bytes > o.maxBytes) stop('bytes');
    });
    child.stderr.on('data', (buf: Buffer) => {
      if (stderr.length < 8_000) stderr += buf.toString('utf8');
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(toHistoryError(stderr, err));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!stopped) {
        const tail = decoder.end();
        if (tail) onText(tail);
      }
      if (stopped || code === 0) resolve({ stopped });
      else reject(toHistoryError(stderr));
    });
  });
}

/** Run git to completion and return stdout (bounded; for small outputs only). */
export async function gitText(args: string[], cwd: string, o: StreamOptions = {}): Promise<string> {
  const parts: string[] = [];
  const maxBytes = o.maxBytes ?? 64 * 1024 * 1024;
  const res = await streamGit(args, cwd, (c) => parts.push(c), { ...o, maxBytes });
  if (res.stopped) throw new HistoryError(res.stopped === 'timeout' ? 'timeout' : 'git_failed', `git ${args[0]} was stopped (${res.stopped})`);
  return parts.join('');
}

/** Run git and report whether it exited 0 (e.g. `merge-base --is-ancestor`); other failures are `false` too. */
export async function gitOk(args: string[], cwd: string, o: StreamOptions = {}): Promise<boolean> {
  try {
    await streamGit(args, cwd, () => undefined, o);
    return true;
  } catch (err) {
    if (err instanceof HistoryError && (err.code === 'aborted' || err.code === 'git_unavailable')) throw err;
    return false;
  }
}
