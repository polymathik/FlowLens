/**
 * Raw git changes → `HistoryCommit`, restricted to the files the map shows.
 *
 * A rename crossing the filter edge changes meaning: `ignored → shown` is an
 * addition, `shown → ignored` a deletion. Copies count as additions of the
 * new path. Type changes are modifications; unmerged/unknown entries are dropped.
 */
import type { HistoryCommit, HistoryFileChange } from '../contracts/history.js';
import type { RawChange, RawCommit } from './log-parser.js';

export function toFileChange(c: RawChange, accepts: (path: string) => boolean): HistoryFileChange | null {
  switch (c.letter) {
    case 'A':
    case 'C':
      return accepts(c.path) ? { path: c.path, status: 'A', added: c.added, deleted: c.deleted } : null;
    case 'M':
    case 'T':
      return accepts(c.path) ? { path: c.path, status: 'M', added: c.added, deleted: c.deleted } : null;
    case 'D':
      return accepts(c.path) ? { path: c.path, status: 'D', added: 0, deleted: c.deleted } : null;
    case 'R': {
      const from = c.from ?? '';
      const toOk = accepts(c.path);
      const fromOk = from !== '' && accepts(from);
      if (toOk && fromOk) return { path: c.path, status: 'R', from, added: c.added, deleted: c.deleted };
      if (toOk) return { path: c.path, status: 'A', added: c.added, deleted: c.deleted };
      if (fromOk) return { path: from, status: 'D', added: 0, deleted: 0 };
      return null;
    }
    default:
      return null;
  }
}

export function toCommit(raw: RawCommit, accepts: (path: string) => boolean): HistoryCommit {
  const files: HistoryFileChange[] = [];
  for (const c of raw.changes) {
    const f = toFileChange(c, accepts);
    if (f) files.push(f);
  }
  return { sha: raw.sha, parents: raw.parents, date: raw.date, author: raw.author, subject: raw.subject, files };
}
