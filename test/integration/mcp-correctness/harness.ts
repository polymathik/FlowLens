/**
 * Test harness: a real git repo copied from test/fixtures/mcp-correctness,
 * indexed at two commits (with automatic snapshots), served by the real
 * FlowLens MCP server over the SDK's in-memory transport.
 *
 * Fixtures use extensionless imports so results don't depend on `.js`
 * specifier resolution (Lane A).
 */

import { cp, mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runIndex } from '../../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import { AnnotationStore } from '../../../src/mcp/annotation-store.js';
import { SnapshotManager } from '../../../src/analysis/snapshot-manager.js';
import { ensureSnapshotForHead } from '../../../src/analysis/snapshot-service.js';
import { createFlowLensServer, type ServerDependencies } from '../../../src/mcp/server.js';
import type { FlowLensConfig } from '../../../src/contracts/config.js';

export const FIXTURE = join(import.meta.dirname, '../../fixtures/mcp-correctness');

const CONFIG: FlowLensConfig = {
  exclude: [],
  languages: { typescript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

export interface Harness {
  rootDir: string;
  deps: ServerDependencies;
  client: Client;
  /** Call a tool; returns the parsed JSON body and the raw result. */
  call(name: string, args?: Record<string, unknown>): Promise<{ body: any; isError: boolean; text: string }>;
  close(): Promise<void>;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

/** Second commit: 5 new public functions, and `storeHelper` removed (breaking). */
async function applyV2(rootDir: string): Promise<void> {
  const extra = [1, 2, 3, 4, 5].map((i) => `export function extra${i}(x: number): number {\n  return x + ${i};\n}\n`).join('\n');
  await writeFile(join(rootDir, 'src/shared/extra.ts'), extra);
  const storePath = join(rootDir, 'src/core/store.ts');
  const store = await readFile(storePath, 'utf-8');
  await writeFile(storePath, store.slice(0, store.indexOf('export function storeHelper')));
}

export async function createHarness(): Promise<Harness> {
  const base = await mkdtemp(join(tmpdir(), 'flowlens-c2-'));
  const rootDir = join(base, 'repo');
  await cp(FIXTURE, rootDir, { recursive: true });
  const flowlensDir = join(rootDir, '.flowlens');
  await mkdir(flowlensDir, { recursive: true });
  await cp(join(rootDir, 'architecture.json'), join(flowlensDir, 'architecture.json'));
  await writeFile(join(rootDir, '.gitignore'), '.flowlens/\n');

  git(rootDir, 'init', '-q', '-b', 'main');
  git(rootDir, 'add', '-A');
  git(rootDir, 'commit', '-q', '-m', 'v1');

  const graph = new LevelGraphStore();
  await graph.open(join(flowlensDir, 'graph'));
  const fileIndexPath = join(flowlensDir, 'file_index.json');
  const index = (incremental: boolean) => runIndex({ rootDir, graphStore: graph, config: CONFIG, fileIndexPath, incremental });

  await index(false);
  await ensureSnapshotForHead({ graph, rootDir, flowlensDir });
  await applyV2(rootDir);
  git(rootDir, 'add', '-A');
  git(rootDir, 'commit', '-q', '-m', 'v2');
  await index(true);
  await ensureSnapshotForHead({ graph, rootDir, flowlensDir });

  const annotationStore = new AnnotationStore(join(flowlensDir, 'annotations.json'));
  await annotationStore.load();
  const deps: ServerDependencies = {
    graph,
    annotationStore,
    snapshotManager: new SnapshotManager(join(flowlensDir, 'snapshots')),
    flowlensDir,
    rootDir,
    fileIndexPath,
  };

  const server = createFlowLensServer(deps);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'c2-test', version: '0.0.0' });
  await client.connect(clientT);

  return {
    rootDir,
    deps,
    client,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as Array<{ text: string }>)[0]?.text ?? '';
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* SDK-level errors are plain text */ }
      return { body, isError: Boolean(r.isError), text };
    },
    async close() {
      await client.close();
      await server.close();
      await graph.close();
      await rm(base, { recursive: true, force: true });
    },
  };
}
