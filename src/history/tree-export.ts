/**
 * Write the source files of a commit into a directory *without touching the
 * working tree*: `git ls-tree` lists the commit's blobs, the ones the map
 * would index (plus the few files module resolution needs, like
 * `tsconfig.json`) are streamed out of `git cat-file --batch` and written.
 *
 * Why not `git archive | tar -x`: `git archive` fails when any pathspec
 * matches nothing (so it cannot be limited to source extensions), and
 * extracting a whole tree writes every asset of the repo. This reads only
 * what is needed, needs no `tar`, and never creates symlinks or submodules.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { HistoryError } from '../contracts/history.js';
import type { Deadline } from './deadline.js';
import type { HistoryFileFilter } from './file-filter.js';
import { GIT_SAFE_FLAGS, gitEnv, gitText, toHistoryError } from './git-run.js';

const RESOLUTION_FILE = /(^|\/)(package\.json|(ts|js)config(\.[\w-]+)?\.json|pnpm-workspace\.yaml|go\.mod|pyproject\.toml|Cargo\.toml)$/;

export interface ExportOptions {
  rootDir: string;
  sha: string;
  dest: string;
  filter: HistoryFileFilter;
  deadline: Deadline;
  signal?: AbortSignal;
  maxBytes: number;
  maxFiles: number;
}

interface Entry { path: string; oid: string }

export const wanted = (f: HistoryFileFilter, path: string): boolean =>
  f.accepts(path) || (RESOLUTION_FILE.test(path) && f.unignored(path));

/** Blobs of `sha` below `rootDir` that should be exported (paths relative to `rootDir`, which may be a subdirectory of the repo). */
export async function listEntries(o: Pick<ExportOptions, 'rootDir' | 'sha' | 'filter' | 'signal'>): Promise<Entry[]> {
  const out = await gitText(['ls-tree', '-r', '-z', o.sha, '--', '.'], o.rootDir, { signal: o.signal, timeoutMs: 60_000 });
  const entries: Entry[] = [];
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, oid] = rec.slice(0, tab).split(' ');
    if (type !== 'blob' || mode === '120000') continue; // no submodules, no symlinks
    entries.push({ path: rec.slice(tab + 1), oid });
  }
  return entries.filter((e) => wanted(o.filter, e.path));
}

function safeTarget(dest: string, rel: string): string | null {
  if (rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '.git' || s === '')) return null;
  const abs = resolve(dest, rel);
  return abs.startsWith(dest + sep) ? abs : null;
}

/** Export the commit's files into `dest`; returns the number of files and bytes written. */
export async function exportTree(o: ExportOptions): Promise<{ files: number; bytes: number }> {
  const dest = resolve(o.dest);
  const entries = await listEntries(o); // paths relative to rootDir (ls-tree is cwd-relative)
  if (entries.length > o.maxFiles) throw new HistoryError('git_failed', `Too many files at this commit (${entries.length} > ${o.maxFiles})`);
  if (entries.length === 0) return { files: 0, bytes: 0 };

  const child = spawn('git', [...GIT_SAFE_FLAGS, 'cat-file', '--batch'], { cwd: o.rootDir, env: gitEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b: Buffer) => { if (stderr.length < 4000) stderr += b.toString(); });
  child.stdin.on('error', () => undefined);
  child.stdin.end(entries.map((e) => `${e.oid}\n`).join(''));
  const exited = new Promise<number | null>((res) => child.on('close', res));
  child.on('error', () => undefined);

  const made = new Set<string>();
  let files = 0;
  let bytes = 0;
  let idx = 0;
  let header = '';
  let want = -1; // bytes of the current body still owed (size + trailing newline)
  let size = 0;
  let chunks: Buffer[] = [];
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      o.deadline.check();
      let off = 0;
      while (off < chunk.length) {
        if (want < 0) {
          const nl = chunk.indexOf(0x0a, off);
          if (nl < 0) { header += chunk.toString('latin1', off); break; }
          header += chunk.toString('latin1', off, nl);
          off = nl + 1;
          const parts = header.split(' ');
          header = '';
          if (parts[1] === 'missing') { idx++; continue; }
          size = Number(parts[2]);
          want = size + 1;
          chunks = [];
          continue;
        }
        const take = Math.min(want, chunk.length - off);
        chunks.push(chunk.subarray(off, off + take));
        off += take;
        want -= take;
        if (want > 0) continue;
        const content = Buffer.concat(chunks).subarray(0, size);
        const entry = entries[idx++];
        want = -1;
        bytes += content.length;
        if (bytes > o.maxBytes) throw new HistoryError('git_failed', `Sources at this commit exceed ${Math.round(o.maxBytes / 1048576)} MB`);
        const target = safeTarget(dest, entry.path);
        if (!target) continue;
        const dir = dirname(target);
        if (!made.has(dir)) { await mkdir(dir, { recursive: true }); made.add(dir); }
        await writeFile(target, content);
        files++;
      }
    }
  } catch (err) {
    child.kill('SIGKILL');
    throw err;
  }
  const code = await exited;
  if (code !== 0 && code !== null && files < entries.length) throw toHistoryError(stderr);
  return { files, bytes };
}
