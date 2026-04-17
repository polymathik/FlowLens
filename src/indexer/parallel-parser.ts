/**
 * Parallel parser — distributes file parsing across worker threads for
 * large indexing runs. Below PARALLEL_THRESHOLD files, stays serial because
 * worker startup overhead (~100-200ms per worker) outweighs savings.
 *
 * The core work — read + hash + parse — is pure and packaged into
 * `parseChunk`. That function is also the worker entry point (via
 * `parse-worker.ts`) AND the serial-path implementation. Unit tests target
 * `parseChunk` directly so the parallel codepath doesn't need a live
 * worker harness in CI.
 *
 * Graph writes stay on the main thread — LevelGraph is not concurrency-safe.
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import type { DiscoveredFile } from '../contracts/discovery.js';
import type { Entity } from '../contracts/entities.js';
import type { Relation } from '../contracts/relations.js';
import type { ParseError } from '../contracts/parser.js';
import { AstGrepParser } from '../parser/ast-grep-parser.js';
import { hashContent } from '../utils/hash.js';

/** Threshold above which workers are worth spinning up. */
export const PARALLEL_THRESHOLD = 1000;

/** Cap on worker count even on many-core machines. */
export const MAX_WORKERS = 4;

export interface ParseChunkInput {
  files: DiscoveredFile[];
  rootDir: string;
}

export interface ParsedFileOutput {
  path: string;
  hash: string;
  entities: Entity[];
  relations: Relation[];
  errors: ParseError[];
}

export interface ParseChunkOutput {
  parsed: ParsedFileOutput[];
  /** File-level failures (read/parse threw). Non-fatal at the orchestrator level. */
  failures: Array<{ path: string; message: string }>;
}

export interface ParallelParseOptions {
  /** Force serial mode (used by tests). */
  serial?: boolean;
  /** Override the worker count (default: min(cpu-1, MAX_WORKERS)). */
  workerCount?: number;
  /** Override the threshold (for testing the parallel path on small inputs). */
  threshold?: number;
}

/**
 * Pure parsing function — reads + hashes + parses each file. Does NOT touch
 * the graph. Catches per-file errors into `failures` so one bad file
 * doesn't kill a whole chunk.
 */
export async function parseChunk(
  input: ParseChunkInput,
): Promise<ParseChunkOutput> {
  const parser = new AstGrepParser(input.rootDir);
  const parsed: ParsedFileOutput[] = [];
  const failures: Array<{ path: string; message: string }> = [];

  for (const file of input.files) {
    try {
      const content = await readFile(path.join(input.rootDir, file.path), 'utf-8');
      const hash = hashContent(content);
      const result = await parser.parseFile(file.path, content);
      parsed.push({
        path: file.path,
        hash,
        entities: result.entities,
        relations: result.relations,
        errors: result.errors,
      });
    } catch (err) {
      failures.push({
        path: file.path,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { parsed, failures };
}

/**
 * Parse a batch of files, optionally using worker threads. Returns the
 * same shape as `parseChunk` — the orchestrator aggregates worker results.
 */
export async function parallelParse(
  files: DiscoveredFile[],
  rootDir: string,
  opts: ParallelParseOptions = {},
): Promise<ParseChunkOutput> {
  const threshold = opts.threshold ?? PARALLEL_THRESHOLD;
  const forceSerial = opts.serial ?? files.length < threshold;

  if (forceSerial) {
    return parseChunk({ files, rootDir });
  }

  const workers = Math.max(
    1,
    Math.min(opts.workerCount ?? os.cpus().length - 1, MAX_WORKERS),
  );
  const chunks = chunkInto(files, workers);

  const results = await Promise.all(
    chunks.map((chunk) => runInWorker({ files: chunk, rootDir })),
  );

  return results.reduce<ParseChunkOutput>(
    (acc, r) => ({
      parsed: acc.parsed.concat(r.parsed),
      failures: acc.failures.concat(r.failures),
    }),
    { parsed: [], failures: [] },
  );
}

/** Split an array into N roughly-even chunks. */
function chunkInto<T>(arr: T[], n: number): T[][] {
  if (n <= 1) return [arr];
  const size = Math.ceil(arr.length / n);
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Dispatch a chunk to a worker and await its single-message reply. */
function runInWorker(input: ParseChunkInput): Promise<ParseChunkOutput> {
  return new Promise((resolve, reject) => {
    const workerUrl = new URL('./parse-worker.js', import.meta.url);
    // Sanity guard: if the compiled worker doesn't exist (e.g. we're in
    // source-only mode), reject synchronously so the caller can fall back.
    if (!workerUrl.pathname.endsWith('parse-worker.js')) {
      reject(new Error('parse-worker.js URL not resolvable'));
      return;
    }
    const worker = new Worker(fileURLToPath(workerUrl), {
      workerData: input,
    });
    worker.once('message', (result: ParseChunkOutput) => resolve(result));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`parse worker exited ${code}`));
    });
  });
}
