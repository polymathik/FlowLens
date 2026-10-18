/**
 * Load a HealthInput from a project's `.flowlens/` directory (the only
 * I/O in the health engine). Reads the graph, manifest, project identity,
 * architecture rules and git history; tolerates every optional piece being
 * absent. The graph store is injectable so the graph service (Lane B) can
 * hand in its own client instead of opening LevelDB.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { computeChurn } from '../analysis/churn-analyzer.js';
import type { FileChurnData } from '../contracts/analysis/churn.js';
import type { ArchitectureConfig } from '../contracts/architecture.js';
import type { GraphStore } from '../contracts/graph.js';
import type { HealthInput } from '../contracts/health.js';
import type { GraphManifest } from '../contracts/manifest.js';
import { LevelGraphStore } from '../graph/levelgraph-store.js';
import { getLastIndexed } from '../mcp/last-indexed.js';
import { readProjectIdentity } from '../utils/project-identity.js';
import { HEALTH_THRESHOLDS } from './config.js';

export class HealthGraphMissingError extends Error {
  constructor(public readonly flowlensDir: string) {
    super(`No FlowLens graph found in ${flowlensDir}`);
    this.name = 'HealthGraphMissingError';
  }
}

export interface LoadOptions {
  /** Already-open store; when given, it is not opened or closed here. */
  graphStore?: GraphStore;
  /** Git history window in days (default 90). */
  churnDays?: number;
  /** Skip git entirely (treat as no history). */
  noGit?: boolean;
}

export async function loadHealthInput(rootDir: string, opts: LoadOptions = {}): Promise<HealthInput> {
  const root = resolve(rootDir);
  const flowlensDir = join(root, '.flowlens');
  const graphDir = join(flowlensDir, 'graph');
  if (!opts.graphStore && !existsSync(graphDir)) throw new HealthGraphMissingError(flowlensDir);

  const { entities, relations } = await readGraph(graphDir, opts.graphStore);
  const manifest = readJson<GraphManifest>(join(flowlensDir, 'manifest.json'));
  const identity = readProjectIdentity(flowlensDir);
  const architecture = readJson<ArchitectureConfig>(join(flowlensDir, 'architecture.json'));
  const git = opts.noGit ? null : gitInfo(root);
  const churn = git ? await loadChurn(root, git.prefix, opts.churnDays ?? HEALTH_THRESHOLDS.change.period_days) : null;
  const fileIndex = join(flowlensDir, 'file_index.json');

  return {
    entities,
    relations,
    project: { id: identity?.id ?? manifest?.project_id ?? null, name: basename(root), root },
    manifest: isManifest(manifest) ? manifest : null,
    churn,
    architecture: architecture && Array.isArray(architecture.layers) ? architecture : null,
    current_git_head: git?.head ?? null,
    last_indexed_fallback: (await safe(() => getLastIndexed(fileIndex))) || null,
  };
}

async function readGraph(graphDir: string, injected?: GraphStore) {
  const store = injected ?? new LevelGraphStore();
  if (!injected) await store.open(graphDir);
  try {
    const [entities, relations] = await Promise.all([store.getAllNodes(), store.getAllEdges()]);
    return { entities, relations };
  } finally {
    if (!injected) await store.close();
  }
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function isManifest(m: GraphManifest | null): m is GraphManifest {
  return Boolean(m && typeof m.completion === 'string' && m.errors && Array.isArray(m.errors.failed_files));
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).trim();
  } catch {
    return null;
  }
}

/** HEAD and the project's path inside the repo (git paths are repo-relative). */
function gitInfo(root: string): { head: string | null; prefix: string } | null {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return null;
  return { head: git(root, ['rev-parse', 'HEAD']), prefix: git(root, ['rev-parse', '--show-prefix']) ?? '' };
}

/** Churn keyed by project-relative path (strips the repo prefix). */
async function loadChurn(root: string, prefix: string, days: number): Promise<Map<string, FileChurnData>> {
  const raw = await computeChurn(root, { period_days: days });
  if (!prefix) return raw;
  const out = new Map<string, FileChurnData>();
  for (const [file, data] of raw) {
    if (file.startsWith(prefix)) {
      const rel = file.slice(prefix.length);
      out.set(rel, { ...data, file: rel });
    }
  }
  return out;
}
