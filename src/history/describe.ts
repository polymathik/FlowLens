/** One-line, human-readable descriptions of the history caches (CLI `history show`, logs). */
import type { HistorySummary, HistoryTopology } from '../contracts/history.js';

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '?');

export function describeHistory(h: HistorySummary): string {
  const t = h.totals;
  const sha = h.head.slice(0, 7);
  return `${t.commits} commits${h.truncated ? ' (newest only)' : ''} on ${h.branch}@${sha}, ${day(t.first_date)} → ${day(t.last_date)}, ${t.files_ever} files seen`
    + `${h.shallow ? ', shallow clone' : ''}`;
}

export function describeTopology(t: HistoryTopology): string {
  const edges = t.samples.reduce((n, s) => n + s.edges.length, 0);
  return `${t.samples.length} topology samples (every ${t.every} commits), ${t.files.length} files, ${edges} edges`
    + `${t.skipped.length ? `, ${t.skipped.length} skipped` : ''}${t.capped ? ', capped' : ''}`;
}
