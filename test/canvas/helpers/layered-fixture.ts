/**
 * The layered-project fixture (Routes -> Services -> Data, one deliberate
 * Routes -> Data rule break) as an indexed project with its rules installed in
 * `.flowlens/architecture.json`, plus a few files no layer includes (so the
 * Unassigned zone exists) and a second consumer per layer for a fuller picture.
 */
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { indexProject } from './fixture-project.js';

export const LAYERED_PROJECT = resolve(import.meta.dirname, '../../fixtures/layered-project');

const EXTRA: Record<string, string> = {
  'shared/format.ts': 'export function fmt(n: number): string {\n  return String(n);\n}\n',
  'routes/health.ts': "import { UserService } from '../services/user-service';\n\nexport function health() {\n  return UserService.findAll().length;\n}\n",
  'services/audit.ts': "import { UserRepo } from '../data/user-repo';\n\nexport function audit() {\n  return UserRepo.findAll().length;\n}\n",
  'package.json': JSON.stringify({ name: 'layered-app', version: '1.0.0' }, null, 2),
};

export async function createLayeredProject(parent: string): Promise<{ rootDir: string; flowlensDir: string }> {
  const rootDir = join(parent, 'layered-app');
  await cp(LAYERED_PROJECT, rootDir, { recursive: true });
  for (const [rel, text] of Object.entries(EXTRA)) {
    await mkdir(join(rootDir, rel, '..'), { recursive: true });
    await writeFile(join(rootDir, rel), text);
  }
  const flowlensDir = await indexProject(rootDir);
  await cp(join(LAYERED_PROJECT, 'architecture.json'), join(flowlensDir, 'architecture.json'));
  return { rootDir, flowlensDir };
}
