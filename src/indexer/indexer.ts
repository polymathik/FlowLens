/**
 * Indexer orchestrator (Phase 8 two-pass pipeline):
 *
 *   discover → detect changes → parse changed files (pass 1)
 *   → find dependents (reverse imports, package scope, removed targets)
 *   → parse dependents → rebuild project symbol table
 *   → resolve pending relations (pass 2) → write graph
 *   → sync module nodes → file index (hash only after success)
 *   → symbols snapshot → churn → quality → manifest.
 */
import { dirname, join, resolve as resolvePath } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { GraphStore } from '../contracts/graph.js';
import type { FlowLensConfig } from '../contracts/config.js';
import type { DiscoveredFile } from '../contracts/discovery.js';
import type { IndexManifest } from '../contracts/quality.js';
import type { IndexResult } from '../contracts/indexer.js';
import type { FileSymbolRecord } from '../contracts/symbols.js';
import { GRAPH_SCHEMA_VERSION } from '../contracts/manifest.js';
import { FileIndexManager } from './file-index.js';
import { clearModuleResolverCaches } from '../parser/resolution/ts-module-resolver.js';
import { recheckBinding } from '../parser/resolution/recheck.js';
import { loadSymbolSnapshot, saveSymbolSnapshot, recordFromParsed } from './symbol-snapshot.js';
import { findDependents } from './dependents.js';
import { runPass2, countIdCollisions, strictIds } from './pass2.js';
import {
  discoverProjectFiles, detectChanges, parseBatch, writeFileGraph, deleteFileGraph,
  syncModuleEntities, enrichWithChurnMetrics, updateFileIndex,
} from './index-steps.js';
import type { ParsedFileOutput } from './parallel-parser.js';
import { computeGraphQuality } from '../quality/graph-quality.js';
import { manifestStore } from '../manifest/manifest-store.js';
import { readGitInfo } from '../manifest/git-info.js';
import { flowlensVersion, PARSER_VERSION } from '../manifest/version.js';
import { ensureProjectIdentity } from '../utils/project-identity.js';
import { withIndexLock } from './index-lock.js';

export { getSupportedExtensions } from './index-steps.js';

export type { IndexResult } from '../contracts/indexer.js';

export interface IndexOptions {
  rootDir: string;
  graphStore: GraphStore;
  config: FlowLensConfig;
  fileIndexPath: string;
  incremental: boolean;
  /** `.flowlens/` directory (default: the directory of `fileIndexPath`). */
  flowlensDir?: string;
  /**
   * Watch-mode hint: only these root-relative paths may have changed or been
   * deleted, so only they are hashed. Dependents are still re-resolved.
   * Ignored on full runs and when there is no symbol snapshot yet.
   */
  paths?: string[];
  /** Called once if another index run on this project holds the index lock. */
  onLockWait?: (holderPid?: number) => void;
}

/**
 * One indexer run, holding the project's cross-process index lock
 * (`.flowlens/index.lock`) for its whole duration: the run reads and then
 * rewrites symbols.json/file_index.json, so overlapping runs lose edits.
 */
export async function runIndex(options: IndexOptions): Promise<IndexResult> {
  const flowlensDir = options.flowlensDir ?? dirname(options.fileIndexPath);
  mkdirSync(flowlensDir, { recursive: true });
  return withIndexLock(flowlensDir, () => runIndexLocked(options), options.onLockWait);
}

async function runIndexLocked(options: IndexOptions): Promise<IndexResult> {
  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const { graphStore: store, config, fileIndexPath, incremental } = options;
  const rootDir = resolvePath(options.rootDir);
  const flowlensDir = options.flowlensDir ?? dirname(fileIndexPath);
  const snapshotPath = join(flowlensDir, 'symbols.json');
  const errors: Array<{ file: string; message: string }> = [];
  clearModuleResolverCaches();

  const identity = ensureProjectIdentity(flowlensDir, rootDir);
  const git = readGitInfo(rootDir);
  const baseManifest = (): IndexManifest => ({
    project_id: identity.id, root: rootDir, schema_version: GRAPH_SCHEMA_VERSION,
    flowlens_version: flowlensVersion(), parser_version: PARSER_VERSION,
    git_head: git.head, git_dirty: git.dirty, completion: 'in_progress',
    started_at: startedAt, finished_at: null, file_count: 0, entity_count: 0, relation_count: 0,
    errors: { parse_failures: 0, unresolved_relations: 0, ambiguous_relations: 0, failed_files: [] },
  });
  // An index written by an older parser is rebuilt even if no file changed: resolution
  // and extraction rules (e.g. source-first workspace imports, .svelte files) moved on.
  const prior = (incremental ? await manifestStore.read(flowlensDir) : null) as IndexManifest | null;
  const parserChanged = !!prior && prior.parser_version !== PARSER_VERSION;
  await manifestStore.write(flowlensDir, baseManifest());

  // 1–2. discover + change detection
  const { discovered, languageCounts } = await discoverProjectFiles(rootDir, config);
  const previous = incremental ? await loadSymbolSnapshot(snapshotPath) : new Map<string, FileSymbolRecord>();
  const hint = options.paths && previous.size > 0 && !parserChanged ? new Set(options.paths) : undefined;
  const { changed, deleted, previousIndex } = await detectChanges(discovered, fileIndexPath, incremental, hint, parserChanged);
  const records = new Map(previous);
  for (const d of deleted) records.delete(d);

  // 3. pass 1 on changed files
  const first = await parseBatch(changed, rootDir);
  const parsed: ParsedFileOutput[] = [...first.parsed];
  const failures = [...first.failures];
  for (const p of first.parsed) if (!p.failed) records.set(p.path, recordFromParsed(p));

  // 4. dependents of what changed → re-parse them too (incremental only)
  let reresolved = 0;
  if (incremental && previous.size > 0 && (changed.length > 0 || deleted.length > 0)) {
    const touched = new Set([...changed.map((f) => f.path), ...deleted]);
    const owners = await ownersOfRemovedTargets(store, previous, records, touched);
    const deps = findDependents({
      records, previous, touched, ownersOfRemovedTargets: owners,
      recheck: (b, from, lang) => recheckBinding(b, from, lang, rootDir),
    });
    const byPath = new Map(discovered.map((f) => [f.path, f]));
    const depFiles = [...deps].map((p) => byPath.get(p)).filter((f): f is DiscoveredFile => !!f);
    const second = await parseBatch(depFiles, rootDir);
    parsed.push(...second.parsed);
    failures.push(...second.failures);
    for (const p of second.parsed) if (!p.failed) records.set(p.path, recordFromParsed(p));
    reresolved = second.parsed.length;
  }

  // 5. identity check
  const collisions = countIdCollisions(records);
  if (collisions.count > 0) {
    const msg = `${collisions.count} entity id collision(s): ${collisions.examples.join('; ')}`;
    if (strictIds()) throw new Error(msg);
    errors.push({ file: '', message: msg });
  }

  // 6. pass 2 + store writes
  for (const d of deleted) await deleteFileGraph(store, d);
  const pass2 = runPass2(records, parsed);
  let entitiesCreated = 0;
  let relationsCreated = 0;
  let unresolvedRelations = 0;
  for (const file of parsed) {
    for (const err of file.errors) errors.push({ file: err.file, message: err.message });
    const edges = pass2.byFile.get(file.path);
    if (file.failed || !edges) continue;
    await writeFileGraph(store, file, edges);
    entitiesCreated += file.entities.length;
    relationsCreated += edges.edges.length;
    unresolvedRelations += edges.unresolved.length;
  }
  const parsedPaths = new Set(parsed.map((p) => p.path));
  for (const f of failures) if (!parsedPaths.has(f.path)) errors.push({ file: f.path, message: f.message });
  const modules = await syncModuleEntities(store, [...records.keys()]);
  entitiesCreated += modules.created;

  // 7. bookkeeping
  const newIndex = updateFileIndex(previousIndex, parsed, failures, deleted);
  await new FileIndexManager().save(fileIndexPath, newIndex);
  await saveSymbolSnapshot(snapshotPath, records);
  if (git.head || existsSync(join(rootDir, '.git'))) {
    // Watch batches only re-stamp churn on the entities they just replaced.
    await enrichWithChurnMetrics(rootDir, store, hint ? new Set(parsed.map((p) => p.path)) : undefined);
  }

  // 8. quality + manifest
  const quality = await computeGraphQuality(store, { records, idCollisions: collisions.count });
  const failedFiles = [...new Set(failures.map((f) => f.path))];
  const manifest: IndexManifest = {
    ...baseManifest(),
    completion: failedFiles.length > 0 ? 'partial' : 'complete',
    finished_at: new Date().toISOString(),
    file_count: records.size,
    entity_count: quality.entity_count,
    relation_count: quality.edge_count,
    errors: {
      parse_failures: failedFiles.length,
      unresolved_relations: quality.unresolved_count,
      ambiguous_relations: quality.ambiguous_count,
      failed_files: failedFiles.slice(0, 20),
    },
    quality,
  };
  await manifestStore.write(flowlensDir, manifest);

  return {
    filesDiscovered: discovered.length,
    filesIndexed: parsed.length,
    filesSkipped: discovered.length - parsed.length,
    filesDeleted: deleted.length,
    filesReresolved: reresolved,
    entitiesCreated,
    relationsCreated,
    unresolvedRelations,
    languageCounts,
    errors,
    duration: Date.now() - startTime,
    quality,
    manifest,
  };
}

/** Files owning edges into entity ids that existed before this run but no longer do. */
async function ownersOfRemovedTargets(
  store: GraphStore,
  previous: Map<string, FileSymbolRecord>,
  records: Map<string, FileSymbolRecord>,
  touched: Set<string>,
): Promise<Set<string>> {
  const owners = new Set<string>();
  for (const file of touched) {
    const before = previous.get(file);
    if (!before) continue;
    const now = new Set((records.get(file)?.entities ?? []).map((e) => e.id));
    for (const e of before.entities) {
      if (now.has(e.id)) continue;
      for (const edge of await store.getEdgesTo(e.id)) {
        if (edge.location.file !== file) owners.add(edge.location.file);
      }
    }
  }
  return owners;
}
