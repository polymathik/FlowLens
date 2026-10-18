/** Throw-away git repositories for history tests (real git, no mocks). */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Repo {
  dir: string;
  git(...args: string[]): string;
  write(path: string, content: string | Buffer): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  /** Stage everything and commit; returns the new sha. Dates advance one minute per commit. */
  commit(message: string, o?: { author?: string; allowEmpty?: boolean }): string;
  sha(ref?: string): string;
  cleanup(): Promise<void>;
}

let clock = Date.parse('2026-01-01T10:00:00Z');

export async function makeRepo(o: { init?: boolean; dir?: string } = {}): Promise<Repo> {
  const dir = o.dir ?? (await realpath(await mkdtemp(join(tmpdir(), 'flowlens-hist-test-'))));
  const run = (args: string[], env: Record<string, string> = {}): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', ...env } });
  if (o.init !== false) {
    run(['init', '-q', '-b', 'main']);
    run(['config', 'user.email', 'dev@example.invalid']);
    run(['config', 'user.name', 'Dev']);
    run(['config', 'commit.gpgsign', 'false']);
  }
  const repo: Repo = {
    dir,
    git: (...args) => run(args),
    async write(path, content) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    },
    async mv(from, to) {
      await mkdir(dirname(join(dir, to)), { recursive: true });
      run(['mv', from, to]);
    },
    commit(message, c = {}) {
      clock += 60_000;
      const iso = new Date(clock).toISOString();
      const env = { GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso, ...(c.author ? { GIT_AUTHOR_NAME: c.author, GIT_COMMITTER_NAME: c.author } : {}) };
      run(['add', '-A']);
      run(['commit', '-q', ...(c.allowEmpty ? ['--allow-empty'] : []), '-m', message], env);
      return run(['rev-parse', 'HEAD']).trim();
    },
    sha: (ref = 'HEAD') => run(['rev-parse', ref]).trim(),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
  return repo;
}

/** A repo with a small, varied history: adds, edits, rename, delete, binary, odd names, empty commit, merge. */
export async function makeRichRepo(): Promise<Repo & { shas: string[] }> {
  const r = await makeRepo();
  const shas: string[] = [];
  await r.write('src/a.ts', 'export const a = 1;\nexport const b = 2;\n');
  await r.write('src/old-name.ts', Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n');
  await r.write('assets/blob.json', Buffer.from([0, 1, 2, 3, 0, 255]));
  await r.write('README.md', '# hi\n');
  await r.write('we ird/"q" \tname.ts', 'export const odd = 1;\n');
  await r.write('src/ünï.ts', 'export const u = 1;\n');
  shas.push(r.commit('first, with | pipe and "quotes"', { author: 'Zoë Müller' }));
  await r.write('src/a.ts', 'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n');
  shas.push(r.commit('edit a'));
  await r.mv('src/old-name.ts', 'lib/new-name.ts');
  await r.write('lib/new-name.ts', Array.from({ length: 20 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\nexport const extra = 1;\n');
  shas.push(r.commit('rename old-name -> lib/new-name'));
  shas.push(r.commit('empty commit', { allowEmpty: true }));
  await r.write('assets/blob.json', Buffer.from([9, 9, 0, 9]));
  await r.write('docs/notes.md', 'notes\n');
  shas.push(r.commit('binary change + docs only'));
  r.git('rm', '-q', 'src/a.ts');
  shas.push(r.commit('delete a'));
  // a side branch merged with a merge commit
  r.git('checkout', '-q', '-b', 'feature');
  await r.write('feature/f.ts', 'export const f = 1;\n');
  shas.push(r.commit('feature work'));
  r.git('checkout', '-q', 'main');
  await r.write('src/main-only.ts', 'export const m = 1;\n');
  shas.push(r.commit('main work'));
  clock += 60_000;
  const iso = new Date(clock).toISOString();
  r.git('merge', '-q', '--no-ff', 'feature', '-m', 'merge feature');
  void iso;
  return Object.assign(r, { shas });
}
