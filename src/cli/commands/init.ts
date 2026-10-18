/**
 * `flowlens init [--force]`
 *
 * First-run setup:
 *   1. Creates the `.flowlens/` directory structure.
 *   2. Writes default config, annotations, and snapshot index files.
 *   3. Runs a full (non-incremental) index of the project.
 *   4. Infers architecture layers from the indexed graph data.
 *   5. Writes `architecture.json`.
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { openGraphStore } from '../../service/open-graph-store.js';
import { resetFlowlensDir } from '../../service/project-setup.js';
import { runIndex } from '../../indexer/indexer.js';
import { formatQualitySummary } from '../../quality/graph-quality.js';
import { inferArchitecture } from '../../architecture/heuristic-inference.js';
import { runInference } from '../../ai/ai-integration.js';
import { buildTopology } from '../../ai/topology-builder.js';
import type { AIProvider } from '../../contracts/ai-integration.js';
import { printWarning } from '../output.js';
import { SnapshotManager } from '../../analysis/snapshot-manager.js';
import { printHeader, printSuccess, printError, printSummary } from '../output.js';
import type { FlowLensConfig } from '../../contracts/config.js';
import type { Entity } from '../../contracts/entities.js';

/* ---------- Default configuration ---------- */

const DEFAULT_CONFIG: FlowLensConfig = {
  exclude: [
    'node_modules/**',
    'dist/**',
    'build/**',
    'vendor/**',
    '__pycache__/**',
    'target/**',
    '.next/**',
    'coverage/**',
    '.flowlens/**',
    '.git/**',
  ],
  languages: {
    typescript: true,
    javascript: true,
    tsx: true,
    jsx: true,
    python: true,
    go: true,
    rust: true,
    java: true,
    kotlin: true,
    c: true,
    cpp: true,
    css: true,
    html: true,
    json: true,
  },
  ai: {
    enabled: false,
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    api_key_env: 'ANTHROPIC_API_KEY',
  },
};

/* ---------- Entity kinds to collect for architecture inference ---------- */

const ENTITY_KINDS = [
  'class',
  'function',
  'interface',
  'method',
  'variable',
  'type',
  'enum',
  'namespace',
  'module',
] as const;

/* ---------- Command ---------- */

export const initCommand = new Command('init')
  .description('Initialize FlowLens for the current project')
  .option('--force', 'Overwrite existing .flowlens/ directory')
  .option('--ai', 'Use an AI provider to infer architecture layers')
  .option('--provider <provider>', 'AI provider: anthropic, openai, ollama', 'anthropic')
  .option('--model <model>', 'Override the default model for the chosen provider')
  .option('--no-daemon', 'Open the graph directly instead of via the FlowLens daemon')
  .action(async (opts: { force?: boolean; ai?: boolean; provider?: string; model?: string; daemon?: boolean }) => {
    const rootDir = resolve('.');
    const flowlensDir = join(rootDir, '.flowlens');

    if (existsSync(flowlensDir) && !opts.force) {
      printError('.flowlens/ already exists. Use --force to reinitialize.');
      process.exit(1);
    }

    try {
      printHeader('FlowLens Init');

      // Remove old directory if --force
      if (existsSync(flowlensDir)) {
        await resetFlowlensDir(rootDir, { daemon: opts.daemon }); // evicts from daemon, keeps project id
      }

      // Create directory structure
      await mkdir(join(flowlensDir, 'graph'), { recursive: true });
      await mkdir(join(flowlensDir, 'snapshots'), { recursive: true });

      // Write default config
      await writeFile(
        join(flowlensDir, 'config.json'),
        JSON.stringify(DEFAULT_CONFIG, null, 2),
      );
      printSuccess('Created config.json');

      // Write empty annotations
      await writeFile(
        join(flowlensDir, 'annotations.json'),
        JSON.stringify({ annotations: [] }, null, 2),
      );
      printSuccess('Created annotations.json');

      // Write empty snapshot index
      await writeFile(
        join(flowlensDir, 'snapshots', 'index.json'),
        JSON.stringify({}, null, 2),
      );

      // Open graph store and run full index
      const graphStore = await openGraphStore(rootDir, { daemon: opts.daemon, client: 'init' });

      const result = await runIndex({
        rootDir,
        graphStore,
        config: DEFAULT_CONFIG,
        fileIndexPath: join(flowlensDir, 'file_index.json'),
        incremental: false,
      });

      printSuccess(`Indexed ${result.filesIndexed} files`);

      // Collect all entities from the graph for architecture inference
      const allEntities: Entity[] = await graphStore.getNodesByKind('file');

      for (const kind of ENTITY_KINDS) {
        const kindEntities = await graphStore.getNodesByKind(kind);
        allEntities.push(...kindEntities);
      }

      // Infer architecture: AI-assisted when --ai is passed, with automatic
      // fall-back to the heuristic if the provider fails. Relations come from
      // the graph so both paths can use import-based layer analysis.
      const allRelations = await graphStore.getAllEdges();

      let archConfig = inferArchitecture(allEntities, allRelations);
      if (opts.ai) {
        const topology = buildTopology(allEntities, allRelations);
        const outcome = await runInference(
          {
            provider: (opts.provider as AIProvider) ?? 'anthropic',
            model: opts.model,
          },
          topology,
        );
        if (outcome.ok) {
          archConfig = outcome.config;
          printSuccess(`AI inference (${opts.provider}) produced ${archConfig.layers.length} layers`);
        } else {
          printWarning(`AI inference failed: ${outcome.error}`);
          printWarning('Falling back to heuristic inference.');
        }
      }
      await writeFile(
        join(flowlensDir, 'architecture.json'),
        JSON.stringify(archConfig, null, 2),
      );
      printSuccess(`Inferred ${archConfig.layers.length} architectural layers`);

      // Take a snapshot at the current git HEAD if available
      try {
        const sha = execSync('git rev-parse HEAD', {
          cwd: rootDir,
          encoding: 'utf-8',
        }).trim();
        const snapshotMgr = new SnapshotManager(join(flowlensDir, 'snapshots'));
        await snapshotMgr.takeSnapshot(graphStore, sha);
        printSuccess(`Snapshot taken at ${sha.slice(0, 8)}`);
      } catch {
        // Not a git repo or git not available — skip snapshot
      }

      await graphStore.close();

      printSummary(result);
      for (const line of formatQualitySummary(result.quality)) console.log(line);
      printSuccess('\nFlowLens initialized successfully!');
    } catch (err) {
      printError(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
