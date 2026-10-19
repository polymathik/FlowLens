/**
 * "Did the agent use FlowLens, and did that coincide with less searching?" A plain comparison of two
 * groups of sessions. Sessions differ in task, so this is a signal, never proof; the wording says so.
 */
import type { AgentSessionStats } from '../../contracts/agent-setup.js';

/** A group needs at least this many sessions (with a readable transcript) before an average is shown. */
export const MIN_GROUP_SESSIONS = 3;

export interface GroupAverages {
  /** Sessions in the group that have a readable transcript (the averages are over these). */
  sessions: number;
  turns: number;
  search_calls: number;
  flowlens_calls: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface ClassifiedSession {
  stats: AgentSessionStats;
  with_flowlens: boolean;
}

export interface Comparison {
  with_flowlens: GroupAverages;
  without_flowlens: GroupAverages;
  /** Sessions in the window / those that used FlowLens (whether or not a transcript was readable). */
  total_sessions: number;
  with_sessions: number;
  /** Enough sessions in both groups for the one-line reading. */
  enough_data: boolean;
  /** Sessions without a readable transcript (excluded from the averages). */
  without_transcript: number;
}

const avg = (sum: number, n: number): number => (n > 0 ? sum / n : 0);

export function averages(sessions: readonly AgentSessionStats[]): GroupAverages {
  const withT = sessions.filter((s) => s.transcript);
  const n = withT.length;
  const sum = (pick: (t: NonNullable<AgentSessionStats['transcript']>, s: AgentSessionStats) => number): number =>
    withT.reduce((acc, s) => acc + pick(s.transcript!, s), 0);
  return {
    sessions: n,
    turns: avg(sum((t) => t.turns), n),
    search_calls: avg(sum((t) => t.search_calls), n),
    flowlens_calls: avg(sum((_, s) => s.flowlens_calls), n),
    input: avg(sum((t) => t.tokens.input), n),
    output: avg(sum((t) => t.tokens.output), n),
    cache_read: avg(sum((t) => t.tokens.cache_read), n),
    cache_write: avg(sum((t) => t.tokens.cache_write), n),
  };
}

export function compareGroups(sessions: readonly ClassifiedSession[]): Comparison {
  const withGroup = sessions.filter((s) => s.with_flowlens).map((s) => s.stats);
  const withoutGroup = sessions.filter((s) => !s.with_flowlens).map((s) => s.stats);
  const a = averages(withGroup);
  const b = averages(withoutGroup);
  return {
    with_flowlens: a,
    without_flowlens: b,
    total_sessions: sessions.length,
    with_sessions: withGroup.length,
    enough_data: a.sessions >= MIN_GROUP_SESSIONS && b.sessions >= MIN_GROUP_SESSIONS,
    without_transcript: sessions.filter((s) => !s.stats.transcript).length,
  };
}

const rounded = (n: number): string => (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));

/** The one-line reading; says there is not enough data when the numbers do not support a comparison. */
export function readingOf(c: Comparison): string {
  const used = `FlowLens tools were used in ${c.with_sessions}/${c.total_sessions} sessions`;
  if (!c.enough_data) {
    return `${used}. Not enough data to compare yet (needs at least ${MIN_GROUP_SESSIONS} sessions with and ${MIN_GROUP_SESSIONS} without FlowLens, with readable transcripts).`;
  }
  const w = c.with_flowlens.search_calls;
  const wo = c.without_flowlens.search_calls;
  const diff = wo - w;
  const pair = `${rounded(w)} vs ${rounded(wo)}`;
  if (Math.abs(diff) < 1) return `${used}; sessions that used them made about the same number of Read/Grep/Glob calls (${pair}).`;
  if (diff > 0) return `${used}; sessions that used them averaged ${rounded(diff)} fewer Read/Grep/Glob calls (${pair}).`;
  return `${used}; sessions that used them averaged ${rounded(-diff)} more Read/Grep/Glob calls (${pair}), so no saving shows up here.`;
}

export const COMPARISON_CAVEAT =
  'Sessions differ in task and size, so compare similar work and treat this as a signal, not proof.';
