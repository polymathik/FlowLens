/**
 * Individual indexer steps: discovery, change detection, parsing batches,
 * store writes, module-node sync and churn enrichment.
 */
import path from 'node:path';
import type { GraphStore } from '../contracts/graph.js';
import type { FlowLensConfig } from '../contracts/config.js';
import type { DiscoveredFile } from '../contracts/discovery.js';
import type { Entity } from '../contracts/entities.js';
import type { FileIndexEntry } from '../contracts/file-index.js';
import { discoverFiles } from '../discovery/file-walker.js';
import { loadIgnorePatterns } from '../discovery/ignore-rules.js';
import { getSupportedExtensions } from '../utils/paths.js';
import { generateEntityId } from '../utils/id.js';
import { computeChurn } from '../analysis/churn-analyzer.js';
import { FileIndexManager } from './file-index.js';
import { parallelParse, PARALLEL_THRESHOLD, type ParsedFileOutput } from './parallel-parser.js';
import type { FileEdges } from './pass2.js';

export { getSupportedExtensions };

export async function discoverProjectFiles(
  rootDir: string,
  config: FlowLensConfig,
): Promise<{ discovered: DiscoveredFile[]; languageCounts: Record<string, number> }> {
  const ignorePatterns = await loadIgnorePatterns(rootDir);
  const excludePatterns = [...ignorePatterns, ...config.exclude];
  const supportedExtensions = getSupportedExtensions(config.languages);
  const discovered = await discoverFiles({ rootDir, excludePatterns, supportedExtensions });
  const languageCounts: Record<string, number> = {};
  for (const file of discovered) languageCounts[file.language] = (languageCounts[file.language] ?? 0) + 1;
  return { discovered, languageCounts };
}

export async function detectChanges(
  discovered: DiscoveredFile[],
  fileIndexPath: string,
  incremental: boolean,
  /** Only these paths may have changed (watch mode): hash just them. */
  hint?: Set<string>,
  /**
   * The parser that wrote the index is older than this one: every file is re-parsed
   * (its output may differ even though its content hash did not), while files that
   * disappeared since are still detected and removed.
   */
  reparseAll = false,
): Promise<{ changed: DiscoveredFile[]; deleted: string[]; previousIndex: Record<string, FileIndexEntry> }> {
  if (!incremental) return { changed: discovered, deleted: [], previousIndex: {} };
  const manager = new FileIndexManager();
  const previousIndex = await manager.load(fileIndexPath);
  if (reparseAll) {
    const present = new Set(discovered.map((f) => f.path));
    return { changed: discovered, deleted: Object.keys(previousIndex).filter((p) => !present.has(p)), previousIndex };
  }
  const candidates = hint ? discovered.filter((f) => hint.has(f.path)) : discovered;
  const known = hint
    ? Object.fromEntries(Object.entries(previousIndex).filter(([p]) => hint.has(p)))
    : previousIndex;
  const { changed, deleted } = await manager.getChangedFiles(candidates, known);
  return { changed, deleted, previousIndex };
}

export interface ParseBatch {
  parsed: ParsedFileOutput[];
  failures: Array<{ path: string; message: string }>;
}

export async function parseBatch(files: DiscoveredFile[], rootDir: string): Promise<ParseBatch> {
  if (files.length === 0) return { parsed: [], failures: [] };
  const out = await parallelParse(files, rootDir, { serial: files.length < PARALLEL_THRESHOLD });
  // Extraction failures come back as parsed-with-failed; report them as failures too.
  const failures = [...out.failures];
  for (const p of out.parsed) {
    if (p.failed) failures.push({ path: p.path, message: p.errors[0]?.message ?? 'parse failed' });
  }
  return { parsed: out.parsed, failures };
}

/** Replace one file's nodes and edges (direct + resolved + unresolved records). */
export async function writeFileGraph(store: GraphStore, file: ParsedFileOutput, edges: FileEdges): Promise<void> {
  if (store.replaceFile) {
    await store.replaceFile(file.path, file.entities, [...edges.edges, ...edges.unresolved]);
    return;
  }
  await store.deleteEdgesByFile(file.path);
  await store.deleteNodesByFile(file.path);
  await store.putNodes(file.entities);
  await store.putEdges([...edges.edges, ...edges.unresolved]);
}

export async function deleteFileGraph(store: GraphStore, filePath: string): Promise<void> {
  await store.deleteEdgesByFile(filePath);
  await store.deleteNodesByFile(filePath);
}

export function moduleEntity(dir: string): Entity {
  const name = path.basename(dir);
  return {
    id: generateEntityId(dir, name, 'module'),
    kind: 'module',
    name,
    qualified_name: dir,
    file: dir,
    location: { line_start: 0, line_end: 0, column_start: 0, column_end: 0 },
    visibility: 'public',
    language: 'unknown',
  };
}

/** Keep exactly one module node per directory that directly contains indexed files. */
export async function syncModuleEntities(store: GraphStore, files: string[]): Promise<{ created: number; deleted: number }> {
  const wanted = new Set<string>();
  for (const f of files) {
    const dir = path.dirname(f);
    if (dir && dir !== '.') wanted.add(dir);
  }
  const existing = await store.getNodesByKind('module');
  const have = new Set<string>();
  let deleted = 0;
  for (const m of existing) {
    if (wanted.has(m.qualified_name)) have.add(m.qualified_name);
    else { await store.deleteNode(m.id); deleted++; }
  }
  const missing = [...wanted].filter((d) => !have.has(d)).map(moduleEntity);
  if (missing.length > 0) await store.putNodes(missing);
  return { created: missing.length, deleted };
}

/**
 * churn_rate and hotspot_score on entities of files git reports activity for.
 * `onlyFiles` limits the writes to files whose entities were just replaced
 * (watch batches); other files keep the churn stored by the last full run.
 */
export async function enrichWithChurnMetrics(rootDir: string, store: GraphStore, onlyFiles?: Set<string>): Promise<void> {
  if (onlyFiles && onlyFiles.size === 0) return;
  const churnData = await computeChurn(rootDir, { period_days: 90 });
  if (churnData.size === 0) return;
  for (const [filePath, churnInfo] of churnData) {
    if (onlyFiles && !onlyFiles.has(filePath)) continue;
    const fileEntities = await store.getNodesByFile(filePath);
    const updated: Entity[] = [];
    for (const entity of fileEntities) {
      if (!entity.metrics) continue;
      entity.metrics.churn_rate = churnInfo.churn_rate;
      const cc = entity.metrics.cognitive_complexity;
      if (typeof cc === 'number') entity.metrics.hotspot_score = churnInfo.churn_rate * cc;
      updated.push(entity);
    }
    if (updated.length > 0) await store.putNodes(updated);
  }
}

/** File-index entries: hash only for files parsed + stored successfully. */
export function updateFileIndex(
  previous: Record<string, FileIndexEntry>,
  parsed: ParsedFileOutput[],
  failures: Array<{ path: string; message: string }>,
  deleted: string[],
): Record<string, FileIndexEntry> {
  const next: Record<string, FileIndexEntry> = { ...previous };
  for (const p of deleted) delete next[p];
  const now = new Date().toISOString();
  for (const f of parsed) if (!f.failed) next[f.path] = { hash: f.hash, last_indexed: now };
  for (const f of failures) {
    const prev = previous[f.path];
    next[f.path] = {
      hash: prev?.status === 'failed' ? prev.hash : (prev?.hash ?? ''),
      last_indexed: prev?.last_indexed ?? now,
      status: 'failed',
      error: f.message.slice(0, 500),
    };
  }
  return next;
}
