/**
 * Builds an indexed copy of the canvas sample-app fixture in a temp dir:
 * copies the sources, creates a small git history (so churn / hotspot
 * metrics exist), indexes into `<dir>/.flowlens/graph` and installs the
 * fixture's architecture rules. Shared by the graph-server API tests and
 * the Playwright E2E server.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runIndex } from '../../../src/indexer/indexer.js';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { FlowLensConfig } from '../../../src/contracts/config.js';

export const SAMPLE_APP = resolve(import.meta.dirname, '../fixtures/sample-app');

const CONFIG: FlowLensConfig = {
  exclude: ['architecture.json'],
  languages: { typescript: true, javascript: true },
  ai: { enabled: false, provider: 'anthropic', model: '', api_key_env: '' },
};

export interface IndexedFixture {
  rootDir: string;
  flowlensDir: string;
  hasGit: boolean;
  cleanup: () => Promise<void>;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'FlowLens Test',
      GIT_AUTHOR_EMAIL: 'test@flowlens.invalid',
      GIT_COMMITTER_NAME: 'FlowLens Test',
      GIT_COMMITTER_EMAIL: 'test@flowlens.invalid',
    },
  });
}

/** A few commits touching store.ts/routes.ts more than the rest → churn. */
async function createHistory(dir: string): Promise<boolean> {
  try {
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'initial');
    for (let i = 1; i <= 3; i++) {
      await appendFile(join(dir, 'src/core/store.ts'), `\n// revision ${i}\n`);
      if (i < 3) await appendFile(join(dir, 'src/api/routes.ts'), `\n// revision ${i}\n`);
      git(dir, 'commit', '-q', '-am', `revision ${i}`);
    }
    return true;
  } catch {
    return false;
  }
}

export async function createIndexedFixture(parent?: string): Promise<IndexedFixture> {
  const base = parent ?? (await mkdtemp(join(tmpdir(), 'flowlens-canvas-')));
  const rootDir = join(base, 'sample-app');
  await cp(SAMPLE_APP, rootDir, { recursive: true });
  const hasGit = await createHistory(rootDir);

  const flowlensDir = join(rootDir, '.flowlens');
  await mkdir(flowlensDir, { recursive: true });
  await writeFile(join(flowlensDir, 'config.json'), JSON.stringify(CONFIG, null, 2));
  await writeFile(join(flowlensDir, 'architecture.json'), await readFile(join(rootDir, 'architecture.json'), 'utf-8'));

  const store = new LevelGraphStore();
  await store.open(join(flowlensDir, 'graph'));
  try {
    await runIndex({
      rootDir,
      graphStore: store,
      config: CONFIG,
      fileIndexPath: join(flowlensDir, 'file_index.json'),
      incremental: false,
    });
  } finally {
    await store.close();
  }

  return {
    rootDir,
    flowlensDir,
    hasGit,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
