/** The flow-app fixture (test/fixtures/flow-app: Hono routes, a CLI, events, a Nest controller, UI) as an indexed project for the Flow mode E2E. */
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { FLOW_APP } from '../../helpers/flow-fixture.js';
import { indexProject } from './fixture-project.js';

export async function createFlowProject(parent: string): Promise<{ rootDir: string; flowlensDir: string }> {
  const rootDir = join(parent, 'flow-app');
  await cp(FLOW_APP, rootDir, { recursive: true });
  const flowlensDir = await indexProject(rootDir);
  return { rootDir, flowlensDir };
}
