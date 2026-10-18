/**
 * An indexed copy of `test/fixtures/flow-app` in a temp dir (shared by the
 * flow integration tests). The graph lives in `<root>/.flowlens/graph`.
 */
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { indexProject } from '../canvas/helpers/fixture-project.js';

export const FLOW_APP = resolve(import.meta.dirname, '../fixtures/flow-app');

export interface FlowFixture {
  rootDir: string;
  flowlensDir: string;
  cleanup: () => Promise<void>;
}

export async function createFlowFixture(): Promise<FlowFixture> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'flowlens-flow-')));
  const rootDir = join(base, 'flow-app');
  await cp(FLOW_APP, rootDir, { recursive: true });
  const flowlensDir = join(rootDir, '.flowlens');
  await indexProject(rootDir);
  return { rootDir, flowlensDir, cleanup: () => rm(base, { recursive: true, force: true }) };
}
