/**
 * Indexer orchestrator — coordinates the full indexing pipeline:
 *   discover files → detect changes → delete stale data →
 *   parse files → extract entities + relations → store in graph →
 *   create module entities → update file index.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { GraphStore } from '../contracts/graph.js';
import type { FlowLensConfig } from '../contracts/config.js';
import type { DiscoveredFile } from '../contracts/discovery.js';
import type { Entity } from '../contracts/entities.js';
import { discoverFiles } from '../discovery/file-walker.js';
import { loadIgnorePatterns } from '../discovery/ignore-rules.js';
import { AstGrepParser } from '../parser/ast-grep-parser.js';
import { FileIndexManager } from './file-index.js';
import { buildUpdatedIndex } from './incremental.js';
import { LANGUAGE_EXTENSIONS } from '../utils/paths.js';
import { hashContent } from '../utils/hash.js';
import { generateEntityId } from '../utils/id.js';
import { computeChurn } from '../analysis/churn-analyzer.js';
import { parallelParse, PARALLEL_THRESHOLD } from './parallel-parser.js';

/* ---------- Public types ---------- */

export interface IndexResult {
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  filesDeleted: number;
  entitiesCreated: number;
  relationsCreated: number;
  languageCounts: Record<string, number>;
  errors: Array<{ file: string; message: string }>;
  duration: number;
}

export interface IndexOptions {
  rootDir: string;
  graphStore: GraphStore;
  config: FlowLensConfig;
  fileIndexPath: string;
  incremental: boolean;
}

/* ---------- Pipeline ---------- */

/**
 * Run the full indexing pipeline.
 */
export async function runIndex(options: IndexOptions): Promise<IndexResult> {
  const startTime = Date.now();

  const { rootDir, graphStore, config, fileIndexPath, incremental } = options;

  const errors: Array<{ file: string; message: string }> = [];
  let entitiesCreated = 0;
  let relationsCreated = 0;

  // --- Step 1: Discover files ---
  const { discovered, languageCounts } = await discoverProjectFiles(rootDir, config);

  // --- Step 2: Determine changes ---
  const { changed, deleted, previousIndex } = await detectChanges(
    discovered, fileIndexPath, incremental,
  );

  // --- Step 3: Delete removed files from graph ---
  const filesDeleted = await deleteStaleFiles(deleted, graphStore);

  // --- Step 4: Parse changed files and store in graph ---
  // Large runs go through worker threads via parallelParse; small runs stay
  // serial (worker startup overhead isn't worth it below PARALLEL_THRESHOLD).
  const fileHashes = new Map<string, string>();

  if (changed.length >= PARALLEL_THRESHOLD) {
    const { parsed, failures } = await parallelParse(changed, rootDir);
    for (const file of parsed) {
      fileHashes.set(file.path, file.hash);
      await graphStore.deleteEdgesByFile(file.path);
      await graphStore.deleteNodesByFile(file.path);
      await graphStore.putNodes(file.entities);
      await graphStore.putEdges(file.relations);
      entitiesCreated += file.entities.length;
      relationsCreated += file.relations.length;
      for (const err of file.errors) {
        errors.push({ file: err.file, message: err.message });
      }
    }
    for (const failure of failures) {
      errors.push({ file: failure.path, message: failure.message });
    }
  } else {
    const parser = new AstGrepParser(rootDir);
    for (const file of changed) {
      const result = await parseAndStore(file, rootDir, parser, graphStore, fileHashes, errors);
      entitiesCreated += result.entities;
      relationsCreated += result.relations;
    }
  }

  // --- Step 5: Create module entities ---
  const moduleCount = await createModuleEntities(changed, graphStore);
  entitiesCreated += moduleCount;

  // --- Step 6: Update file index ---
  const newIndex = buildUpdatedIndex(previousIndex, changed, fileHashes, deleted);
  const fileIndexManager = new FileIndexManager();
  await fileIndexManager.save(fileIndexPath, newIndex);

  // --- Step 7: Enrich entities with git churn metrics ---
  await enrichWithChurnMetrics(rootDir, graphStore);

  // --- Step 8: Return summary ---
  return {
    filesDiscovered: discovered.length,
    filesIndexed: changed.length,
    filesSkipped: discovered.length - changed.length,
    filesDeleted,
    entitiesCreated,
    relationsCreated,
    languageCounts,
    errors,
    duration: Date.now() - startTime,
  };
}

/* ---------- Step 1: File discovery ---------- */

async function discoverProjectFiles(
  rootDir: string,
  config: FlowLensConfig,
): Promise<{ discovered: DiscoveredFile[]; languageCounts: Record<string, number> }> {
  const ignorePatterns = await loadIgnorePatterns(rootDir);
  const excludePatterns = [...ignorePatterns, ...config.exclude];

  const supportedExtensions = getSupportedExtensions(config.languages);

  const discovered = await discoverFiles({
    rootDir,
    excludePatterns,
    supportedExtensions,
  });

  const languageCounts: Record<string, number> = {};
  for (const file of discovered) {
    languageCounts[file.language] = (languageCounts[file.language] ?? 0) + 1;
  }

  return { discovered, languageCounts };
}

/**
 * Filter LANGUAGE_EXTENSIONS by the config.languages enable/disable map.
 * If a language is not listed in config.languages, it is included by default.
 */
function getSupportedExtensions(languages: Record<string, boolean>): string[] {
  return Object.entries(LANGUAGE_EXTENSIONS)
    .filter(([, lang]) => languages[lang] !== false)
    .map(([ext]) => ext);
}

/* ---------- Step 2: Change detection ---------- */

async function detectChanges(
  discovered: DiscoveredFile[],
  fileIndexPath: string,
  incremental: boolean,
): Promise<{
  changed: DiscoveredFile[];
  deleted: string[];
  previousIndex: Record<string, import('../contracts/file-index.js').FileIndexEntry>;
}> {
  const fileIndexManager = new FileIndexManager();

  if (!incremental) {
    return {
      changed: discovered,
      deleted: [],
      previousIndex: {},
    };
  }

  const previousIndex = await fileIndexManager.load(fileIndexPath);
  const { changed, deleted } = await fileIndexManager.getChangedFiles(discovered, previousIndex);

  return { changed, deleted, previousIndex };
}

/* ---------- Step 3: Delete stale files ---------- */

async function deleteStaleFiles(
  deletedPaths: string[],
  graphStore: GraphStore,
): Promise<number> {
  for (const filePath of deletedPaths) {
    await graphStore.deleteEdgesByFile(filePath);
    await graphStore.deleteNodesByFile(filePath);
  }
  return deletedPaths.length;
}

/* ---------- Step 4: Parse and store ---------- */

async function parseAndStore(
  file: DiscoveredFile,
  rootDir: string,
  parser: AstGrepParser,
  graphStore: GraphStore,
  fileHashes: Map<string, string>,
  errors: Array<{ file: string; message: string }>,
): Promise<{ entities: number; relations: number }> {
  try {
    const content = await readFile(path.join(rootDir, file.path), 'utf-8');
    fileHashes.set(file.path, hashContent(content));

    const result = await parser.parseFile(file.path, content);

    // Delete existing data for this file before storing new data
    // (handles re-indexing of changed files in incremental mode)
    await graphStore.deleteEdgesByFile(file.path);
    await graphStore.deleteNodesByFile(file.path);

    await graphStore.putNodes(result.entities);
    await graphStore.putEdges(result.relations);

    for (const err of result.errors) {
      errors.push({ file: err.file, message: err.message });
    }

    return { entities: result.entities.length, relations: result.relations.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    errors.push({ file: file.path, message });
    return { entities: 0, relations: 0 };
  }
}

/* ---------- Step 5: Module entities ---------- */

/**
 * Collect unique directory paths from the indexed files and create
 * a module entity for each directory. Existing module entities for
 * these paths are replaced.
 */
async function createModuleEntities(
  files: DiscoveredFile[],
  graphStore: GraphStore,
): Promise<number> {
  const directories = new Set<string>();

  for (const file of files) {
    const dir = path.dirname(file.path);
    if (dir && dir !== '.') {
      directories.add(dir);
    }
  }

  const moduleEntities: Entity[] = [];

  for (const dir of directories) {
    const dirName = path.basename(dir);
    const entity: Entity = {
      id: generateEntityId(dir, dirName, 'module'),
      kind: 'module',
      name: dirName,
      qualified_name: dir,
      file: dir,
      location: { line_start: 0, line_end: 0, column_start: 0, column_end: 0 },
      visibility: 'public',
      language: 'unknown',
    };
    moduleEntities.push(entity);
  }

  if (moduleEntities.length > 0) {
    await graphStore.putNodes(moduleEntities);
  }

  return moduleEntities.length;
}

/* ---------- Step 7: Churn enrichment ---------- */

/**
 * Compute git churn for the repository and update entity metrics in the graph
 * with `churn_rate` and `hotspot_score` (churn_rate × cognitive_complexity).
 *
 * Silently skips if the directory is not a git repository.
 */
async function enrichWithChurnMetrics(
  rootDir: string,
  graphStore: GraphStore,
): Promise<void> {
  const churnData = await computeChurn(rootDir, { period_days: 90 });
  if (churnData.size === 0) return;

  for (const [filePath, churnInfo] of churnData) {
    const fileEntities = await graphStore.getNodesByFile(filePath);
    for (const entity of fileEntities) {
      if (!entity.metrics) continue;

      entity.metrics.churn_rate = churnInfo.churn_rate;

      const cognitiveComplexity = entity.metrics.cognitive_complexity;
      if (typeof cognitiveComplexity === 'number') {
        entity.metrics.hotspot_score = churnInfo.churn_rate * cognitiveComplexity;
      }

      await graphStore.putNode(entity);
    }
  }
}
