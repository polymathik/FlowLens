import { describe, it, expect, afterAll } from 'vitest';
import { LogParser, parseLog, type RawCommit } from '../../../src/history/log-parser.js';
import { toCommit } from '../../../src/history/changes.js';
import { streamGit } from '../../../src/history/git-run.js';
import { logArgs } from '../../../src/history/read-log.js';
import { makeRichRepo, type Repo } from './git-fixture.js';

const SHA = (n: number): string => n.toString(16).padStart(40, '0');
const H = (n: number, parents: string, subject: string): string => `\x01${SHA(n)}\0${parents}\0\x32026-01-0${n}T10:00:00+00:00\0Ann\0${subject}\0`;

describe('LogParser (-z token stream)', () => {
  const text = [
    H(3, SHA(2), 'rename + modify'),
    '\n:100644 100644 aaaaaaa bbbbbbb R087\0src/old.ts\0src/new.ts\0',
    ':100644 100644 aaaaaaa bbbbbbb M\0src/b.ts\0',
    '1\t0\t\0src/old.ts\0src/new.ts\0',
    '4\t2\tsrc/b.ts\0',
    H(2, SHA(1), 'empty'),
    H(1, '', 'root\twith tab'),
    '\n:000000 100644 0000000 bbbbbbb A\0we ird/"q"\tname.ts\0',
    ':000000 100644 0000000 bbbbbbb A\0bin.dat\0',
    '3\t0\twe ird/"q"\tname.ts\0',
    '-\t-\tbin.dat\0',
  ].join('');

  it('parses renames, empty commits, tabs/quotes in paths and binary files', () => {
    const commits = parseLog(text);
    expect(commits.map((c) => c.subject)).toEqual(['rename + modify', 'empty', 'root\twith tab']);
    expect(commits[0].parents).toEqual([SHA(2)]);
    expect(commits[0].changes).toEqual([
      { letter: 'R', from: 'src/old.ts', path: 'src/new.ts', added: 1, deleted: 0 },
      { letter: 'M', path: 'src/b.ts', added: 4, deleted: 2 },
    ]);
    expect(commits[1].changes).toEqual([]);
    expect(commits[2].parents).toEqual([]);
    expect(commits[2].changes).toEqual([
      { letter: 'A', path: 'we ird/"q"\tname.ts', added: 3, deleted: 0 },
      { letter: 'A', path: 'bin.dat', added: 0, deleted: 0 },
    ]);
  });

  it('gives the same result however the stream is chunked (including one character at a time)', () => {
    const whole = parseLog(text);
    for (const size of [1, 2, 3, 7, 50, 1000]) {
      const out: RawCommit[] = [];
      const p = new LogParser((c) => out.push(c));
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      p.end();
      expect(out).toEqual(whole);
    }
  });

  it('drops the commit being read when git was stopped early (end(false))', () => {
    const out: RawCommit[] = [];
    const p = new LogParser((c) => out.push(c));
    const second = text.indexOf('\x01', 5);
    p.push(text.slice(0, text.indexOf('\x01', second + 5) + 10)); // cut inside the third header
    p.end(false);
    expect(out.map((c) => c.subject)).toEqual(['rename + modify']);
    const q: RawCommit[] = [];
    const p2 = new LogParser((c) => q.push(c));
    p2.push(H(3, SHA(2), 'cut') + '\n:100644 100644 aaaaaaa bbbbbbb M\0a.ts\0');
    p2.end(false);
    expect(q).toEqual([]);
  });

  it('ignores noise before the first header and unknown tokens', () => {
    expect(parseLog('garbage\0\n\0' + H(1, '', 'x') + 'weird token\0').length).toBe(1);
  });
});

describe('changes → HistoryCommit', () => {
  const accepts = (p: string): boolean => p.endsWith('.ts') && !p.startsWith('dist/');
  const raw = (changes: RawCommit['changes']): RawCommit => ({ sha: SHA(1), parents: [], date: 'd', author: 'a', subject: 's', changes });
  it('applies the file filter and re-interprets renames across it', () => {
    const c = toCommit(raw([
      { letter: 'A', path: 'a.ts', added: 5, deleted: 0 },
      { letter: 'A', path: 'logo.png', added: 0, deleted: 0 },
      { letter: 'T', path: 'b.ts', added: 1, deleted: 1 },
      { letter: 'R', from: 'dist/x.ts', path: 'src/x.ts', added: 0, deleted: 0 }, // ignored -> shown = add
      { letter: 'R', from: 'src/y.ts', path: 'dist/y.ts', added: 0, deleted: 0 }, // shown -> ignored = delete
      { letter: 'R', from: 'src/z.ts', path: 'lib/z.ts', added: 2, deleted: 1 },
      { letter: 'C', from: 'src/z.ts', path: 'lib/zz.ts', added: 9, deleted: 0 },
      { letter: 'D', path: 'gone.ts', added: 0, deleted: 7 },
      { letter: 'U', path: 'conflict.ts', added: 0, deleted: 0 },
    ]), accepts);
    expect(c.files).toEqual([
      { path: 'a.ts', status: 'A', added: 5, deleted: 0 },
      { path: 'b.ts', status: 'M', added: 1, deleted: 1 },
      { path: 'src/x.ts', status: 'A', added: 0, deleted: 0 },
      { path: 'src/y.ts', status: 'D', added: 0, deleted: 0 },
      { path: 'lib/z.ts', status: 'R', from: 'src/z.ts', added: 2, deleted: 1 },
      { path: 'lib/zz.ts', status: 'A', added: 9, deleted: 0 },
      { path: 'gone.ts', status: 'D', added: 0, deleted: 7 },
    ]);
  });
});

describe('parsing real git output', () => {
  let repo: (Repo & { shas: string[] }) | undefined;
  afterAll(async () => repo?.cleanup());

  it('survives odd names, non-ASCII authors, binary files, renames, empty commits and merges', async () => {
    repo = await makeRichRepo();
    const run = async (firstParent: boolean): Promise<RawCommit[]> => {
      const out: RawCommit[] = [];
      const p = new LogParser((c) => out.push(c));
      await streamGit(logArgs({ head: repo!.sha(), firstParent }), repo!.dir, (t) => p.push(t));
      p.end();
      return out.reverse();
    };
    const linear = await run(false);
    expect(linear).toHaveLength(8); // 9 commits - the merge
    expect(linear[0].author).toBe('Zoë Müller');
    expect(linear[0].subject).toBe('first, with | pipe and "quotes"');
    const paths = linear[0].changes.map((c) => c.path);
    expect(paths).toContain('we ird/"q" \tname.ts');
    expect(paths).toContain('src/ünï.ts');
    expect(linear[0].changes.find((c) => c.path === 'assets/blob.json')).toMatchObject({ letter: 'A', added: 0, deleted: 0 }); // binary
    expect(linear[2].changes).toEqual([{ letter: 'R', from: 'src/old-name.ts', path: 'lib/new-name.ts', added: 1, deleted: 0 }]);
    expect(linear[3].changes).toEqual([]); // empty commit
    expect(linear[3].parents).toHaveLength(1);

    const fp = await run(true);
    expect(fp).toHaveLength(8);
    const merge = fp[fp.length - 1];
    expect(merge.parents).toHaveLength(2);
    expect(merge.changes).toEqual([{ letter: 'A', path: 'feature/f.ts', added: 1, deleted: 0 }]); // diffed against first parent
    expect(fp.map((c) => c.sha)).not.toContain(repo.shas[6]); // the feature commit itself is not listed
  });
});
