/** Hand-made `HistorySummary` values for the timeline tests. */
import type { HistoryChangeStatus, HistoryCommit, HistoryFileChange, HistorySummary } from '../../../src/contracts/history.js';

export type Change = [status: HistoryChangeStatus, path: string, from?: string, added?: number, deleted?: number];

export const change = ([status, path, from, added, deleted]: Change): HistoryFileChange => ({
  path, status, ...(from ? { from } : {}), added: added ?? (status === 'D' ? 0 : 10), deleted: deleted ?? (status === 'D' ? 10 : 0),
});

/** Commits one day apart starting 2026-01-01 (UTC), each with the given changes. */
export function historyOf(changes: Change[][], extra: Partial<HistorySummary> = {}): HistorySummary {
  const commits: HistoryCommit[] = changes.map((files, i) => ({
    sha: `${(i + 1).toString(16).padStart(2, '0')}${'a'.repeat(38)}`,
    parents: i === 0 ? [] : [`${i.toString(16).padStart(2, '0')}${'a'.repeat(38)}`],
    date: new Date(Date.UTC(2026, 0, 1 + i, 12)).toISOString(),
    author: `author ${i % 2}`,
    subject: `commit ${i}`,
    files: files.map(change),
  }));
  return {
    head: commits[commits.length - 1]?.sha ?? '', branch: 'main', commits, truncated: false,
    totals: { commits: commits.length, files_ever: 0, first_date: commits[0]?.date ?? null, last_date: commits[commits.length - 1]?.date ?? null },
    built_at: '2026-01-01T00:00:00Z', ...extra,
  };
}

/**
 * A story on the zone fixture (see zone-fixture.ts): files appear in three zones, one is renamed into today's
 * `a.ts`, one is re-added after a deletion, two are deleted for good (one inside a folder that still exists
 * as a package, one in a folder that is gone).
 */
export const STORY: Change[][] = [
  /* 0 */ [['A', 'packages/core/src/ids.ts'], ['A', 'packages/core/src/index.ts'], ['A', 'packages/server/src/older.ts']],
  /* 1 */ [['A', 'packages/server/src/b.ts'], ['M', 'packages/core/src/ids.ts'], ['A', 'gone/x.ts']],
  /* 2 */ [['A', 'apps/web/src/app.ts'], ['A', 'packages/server/legacy/old.ts']],
  /* 3 */ [['R', 'packages/server/src/a.ts', 'packages/server/src/older.ts']],
  /* 4 */ [['D', 'packages/server/legacy/old.ts']],
  /* 5 */ [['A', 'docs/tool.ts'], ['D', 'gone/x.ts']],
  /* 6 */ [['D', 'docs/tool.ts']],
  /* 7 */ [['A', 'docs/tool.ts'], ['M', 'packages/server/src/a.ts']],
];
