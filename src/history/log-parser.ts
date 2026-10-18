/**
 * Streaming parser for
 *
 *   git log -z --format=%x01%H%x00%P%x00%cI%x00%an%x00%s --raw --numstat -M [-m --first-parent | --no-merges]
 *
 * With `-z` git prints paths verbatim, NUL-terminated (no C-style quoting, so
 * tabs, quotes, newlines and non-ASCII names survive). The output is a flat
 * stream of NUL-separated tokens:
 *
 *   \x01<sha> <parents> <date> <author> <subject>          5 tokens, one per commit
 *   [\n]:<modes> <shas> <S>   <path>                       --raw, one per file (S = A|M|D|T|U|X)
 *   [\n]:<modes> <shas> R087  <old> <new>                  --raw rename/copy: two path tokens
 *   <added>\t<deleted>\t<path>                             --numstat ('-' for binary)
 *   <added>\t<deleted>\t  <old> <new>                      --numstat rename: empty path, then two tokens
 *
 * Empty commits are a header with nothing after it. Chunks may split tokens
 * anywhere; `push` keeps the unfinished tail.
 */
export interface RawChange {
  /** First letter of git's status (A M D T U X R C). */
  letter: string;
  path: string;
  /** Old path for R / C. */
  from?: string;
  added: number;
  deleted: number;
}

export interface RawCommit {
  sha: string;
  parents: string[];
  date: string;
  author: string;
  subject: string;
  /** In git's order (sorted by path); a rename is keyed by its new path. */
  changes: RawChange[];
}

export const COMMIT_MARK = '\x01';
export const LOG_FORMAT = `--format=${COMMIT_MARK}%H%x00%P%x00%cI%x00%an%x00%s`;

const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

export class LogParser {
  private tail = '';
  private header: string[] | null = null;
  private current: RawCommit | null = null;
  private byPath = new Map<string, RawChange>();
  /** Path tokens still owed to the entry being read. */
  private owed: { kind: 'raw' | 'numstat'; letter: string; added: number; deleted: number; paths: string[]; need: number } | null = null;

  constructor(private readonly onCommit: (c: RawCommit) => void) {}

  /** Feed decoded text. Complete commits are emitted when the next header arrives (or on `end`). */
  push(text: string): void {
    const data = this.tail + text;
    let start = 0;
    for (let i = data.indexOf('\0'); i !== -1; i = data.indexOf('\0', start)) {
      this.token(data.slice(start, i));
      start = i + 1;
    }
    this.tail = data.slice(start);
  }

  /**
   * Flush the final commit. When git was stopped early (`complete: false`) the
   * commit being read may be missing files, so it is dropped instead.
   */
  end(complete = true): void {
    this.tail = '';
    this.header = null;
    this.owed = null;
    if (!complete) this.current = null;
    this.flush();
  }

  private flush(): void {
    if (this.current) this.onCommit(this.current);
    this.current = null;
    this.byPath = new Map();
  }

  private token(t: string): void {
    if (this.header) {
      this.header.push(t);
      if (this.header.length === 5) this.startCommit(this.header);
      return;
    }
    if (this.owed) {
      this.owed.paths.push(t);
      if (this.owed.paths.length === this.owed.need) this.finishEntry();
      return;
    }
    if (t.startsWith(COMMIT_MARK)) {
      this.flush();
      this.header = [t.slice(1)];
      return;
    }
    if (!this.current) return; // noise before the first header
    const s = t.replace(/^\n+/, '');
    if (s.startsWith(':')) {
      const status = s.slice(s.lastIndexOf(' ') + 1);
      const letter = status.charAt(0);
      this.owed = { kind: 'raw', letter, added: 0, deleted: 0, paths: [], need: letter === 'R' || letter === 'C' ? 2 : 1 };
      return;
    }
    const m = NUMSTAT.exec(s);
    if (!m) return;
    const added = m[1] === '-' ? 0 : Number(m[1]);
    const deleted = m[2] === '-' ? 0 : Number(m[2]);
    if (m[3] === '') this.owed = { kind: 'numstat', letter: '', added, deleted, paths: [], need: 2 };
    else this.applyStats(m[3], added, deleted);
  }

  private startCommit(h: string[]): void {
    this.header = null;
    this.current = { sha: h[0], parents: h[1] ? h[1].split(' ') : [], date: h[2], author: h[3], subject: h[4], changes: [] };
  }

  private finishEntry(): void {
    const o = this.owed;
    this.owed = null;
    if (!o || !this.current) return;
    if (o.kind === 'raw') {
      const [a, b] = o.paths;
      const change: RawChange = o.need === 2
        ? { letter: o.letter, from: a, path: b, added: 0, deleted: 0 }
        : { letter: o.letter, path: a, added: 0, deleted: 0 };
      this.byPath.set(change.path, change);
      this.current.changes.push(change);
    } else {
      this.applyStats(o.paths[1], o.added, o.deleted);
    }
  }

  private applyStats(path: string, added: number, deleted: number): void {
    const change = this.byPath.get(path);
    if (change) {
      change.added = added;
      change.deleted = deleted;
    }
  }
}

/** Parse a complete log output (tests and small inputs). */
export function parseLog(text: string): RawCommit[] {
  const out: RawCommit[] = [];
  const parser = new LogParser((c) => out.push(c));
  parser.push(text);
  parser.end();
  return out;
}
