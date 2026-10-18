/**
 * A small monorepo with a real git history for the timeline E2E: 14 commits over two months by two authors in which
 * files appear in three packages and a tools folder, one file is renamed, one is deleted and re-added, two are
 * deleted for good inside a package, one inside a folder that no longer exists. The truth the timeline is checked
 * against is `git ls-tree` of each commit.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { indexProject } from './fixture-project.js';

type Step = { subject: string; author: string; date: string; write: Record<string, string>; remove?: string[]; rename?: Array<[string, string]> };

const ts = (name: string, imports: string[] = [], extra = ''): string =>
  `${imports.map((i, k) => `import { ${i.split('/').pop()!.replace(/\W/g, '_')}Value as v${k} } from '${i}';`).join('\n')}${imports.length ? '\n\n' : ''}export const ${name.replace(/\W/g, '_')}Value = ${imports.length};\nexport function ${name.replace(/\W/g, '_')}(n: number): number {\n  return n + ${imports.map((_, k) => `v${k}`).join(' + ') || '1'};\n}\n${extra}`;
const pkg = (name: string) => JSON.stringify({ name, version: '1.0.0' }, null, 2);

const STEPS: Step[] = [
  { subject: 'chore: workspace and core types', author: 'Ada Lovelace', date: '2026-01-05T09:00:00Z', write: {
    'package.json': JSON.stringify({ name: 'fx', private: true, workspaces: ['packages/*'] }, null, 2), 'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
    'packages/core/package.json': pkg('@fx/core'), 'packages/core/src/ids.ts': ts('ids'), 'packages/core/src/types.ts': ts('types') } },
  { subject: 'feat(core): public index, server skeleton', author: 'Ada Lovelace', date: '2026-01-06T09:00:00Z', write: {
    'packages/core/src/index.ts': ts('index', ['./ids', './types']), 'packages/server/package.json': pkg('@fx/server'),
    'packages/server/src/main.ts': ts('main', ['../../core/src/index']), 'scratch/tmp.ts': ts('tmp') } },
  { subject: 'feat(server): routes', author: 'Grace Hopper', date: '2026-01-09T09:00:00Z', write: {
    'packages/server/src/routes/users.ts': ts('users', ['../../../core/src/ids']), 'packages/server/src/routes/health.ts': ts('health') } },
  { subject: 'feat(web): app shell', author: 'Grace Hopper', date: '2026-01-14T09:00:00Z', write: {
    'packages/core/src/ids.ts': ts('ids', [], '// v2\n'), 'packages/web/package.json': pkg('@fx/web'), 'packages/web/src/app.ts': ts('app', ['../../core/src/index']) } },
  { subject: 'feat(web): button and card', author: 'Ada Lovelace', date: '2026-01-15T09:00:00Z', write: {
    'packages/web/src/ui/button.ts': ts('button'), 'packages/web/src/ui/card.ts': ts('card', ['./button']) } },
  { subject: 'refactor(server): users are people now', author: 'Grace Hopper', date: '2026-01-23T09:00:00Z', write: { 'packages/server/src/main.ts': ts('main', ['../../core/src/index', './routes/people']) },
    rename: [['packages/server/src/routes/users.ts', 'packages/server/src/routes/people.ts']] },
  { subject: 'feat(server): legacy auth shim', author: 'Ada Lovelace', date: '2026-01-27T09:00:00Z', write: {
    'packages/server/src/legacy/old-auth.ts': ts('oldAuth'), 'packages/server/src/legacy/old-token.ts': ts('oldToken') }, remove: ['scratch/tmp.ts'] },
  { subject: 'chore(server): drop the legacy shim', author: 'Grace Hopper', date: '2026-02-02T09:00:00Z', write: {}, remove: ['packages/server/src/legacy/old-auth.ts', 'packages/server/src/legacy/old-token.ts'] },
  { subject: 'feat(web): modal', author: 'Ada Lovelace', date: '2026-02-03T09:00:00Z', write: { 'packages/web/src/ui/modal.ts': ts('modal', ['./button']), 'packages/web/src/app.ts': ts('app', ['../../core/src/index', './ui/modal']) } },
  { subject: 'chore(web): remove card for now', author: 'Grace Hopper', date: '2026-02-04T09:00:00Z', write: {}, remove: ['packages/web/src/ui/card.ts'] },
  { subject: 'feat(web): card is back', author: 'Grace Hopper', date: '2026-02-05T09:00:00Z', write: { 'packages/web/src/ui/card.ts': ts('card', ['./button'], '// back\n') } },
  { subject: 'chore: tools', author: 'Ada Lovelace', date: '2026-02-10T09:00:00Z', write: { 'tools/gen.ts': ts('gen'), 'tools/old-script.ts': ts('oldScript') } },
  { subject: 'chore(tools): remove the old script', author: 'Ada Lovelace', date: '2026-02-11T09:00:00Z', write: {}, remove: ['tools/old-script.ts'] },
  { subject: 'feat(core): util; server main tweak', author: 'Grace Hopper', date: '2026-02-12T09:00:00Z', write: {
    'packages/core/src/util.ts': ts('util'), 'packages/server/src/main.ts': ts('main', ['../../core/src/index', './routes/people'], '// tweak\n') } },
];

function git(cwd: string, step: Step | null, ...args: string[]): void {
  const date = step?.date ?? '2026-01-01T00:00:00Z';
  const name = step?.author ?? 'Fixture';
  execFileSync('git', args, {
    cwd, stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: 'a@fixture.invalid', GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: 'a@fixture.invalid', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

export async function createHistoryProject(parent: string): Promise<{ rootDir: string; flowlensDir: string; commits: number }> {
  const rootDir = join(parent, 'history-app');
  await mkdir(rootDir, { recursive: true });
  git(rootDir, null, 'init', '-q', '-b', 'main');
  for (const step of STEPS) {
    for (const [from, to] of step.rename ?? []) {
      await mkdir(dirname(join(rootDir, to)), { recursive: true });
      git(rootDir, step, 'mv', from, to);
    }
    for (const [file, text] of Object.entries(step.write)) {
      await mkdir(dirname(join(rootDir, file)), { recursive: true });
      await writeFile(join(rootDir, file), text);
    }
    for (const file of step.remove ?? []) await rm(join(rootDir, file));
    git(rootDir, step, 'add', '-A');
    git(rootDir, step, 'commit', '-q', '-m', step.subject);
  }
  return { rootDir, flowlensDir: await indexProject(rootDir), commits: STEPS.length };
}

/** One commit and nothing else: the timeline has nothing to play ("history too short"). */
export async function createSingleCommitProject(parent: string): Promise<{ rootDir: string; flowlensDir: string }> {
  const rootDir = join(parent, 'one-commit-app');
  await mkdir(join(rootDir, 'src'), { recursive: true });
  await writeFile(join(rootDir, 'src/main.ts'), ts('main'));
  await writeFile(join(rootDir, 'src/util.ts'), ts('util', ['./main']));
  git(rootDir, null, 'init', '-q', '-b', 'main');
  git(rootDir, null, 'add', '-A');
  git(rootDir, null, 'commit', '-q', '-m', 'the only commit');
  return { rootDir, flowlensDir: await indexProject(rootDir) };
}
