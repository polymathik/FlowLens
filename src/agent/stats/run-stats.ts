/**
 * `flowlens agent stats`: reads the FlowLens event log and the agent's own transcripts. No graph, no
 * daemon: only files under `<project>/.flowlens/agent-ledger/` and `~/.claude/projects/`.
 */
import { basename, join } from 'node:path';
import type { AgentCommandResult } from '../../contracts/agent.js';
import type { AgentSessionStats } from '../../contracts/agent-setup.js';
import { compareGroups, readingOf, COMPARISON_CAVEAT, type ClassifiedSession, type Comparison } from './compare.js';
import { claudeProjectDirName, claudeProjectsRoot, findClaudeTranscript, scanClaudeHistory, sessionFromTranscript } from './history.js';
import {
  CODEX_NOTE, START_COLLECTING, comparisonTable, legend, readingBlock, sessionDetail, sessionLine, totalsLine,
} from './report.js';
import { listLedgerSessions } from '../ledger.js';
import { loadLedgerSessions, loadSessionStats } from './session-stats.js';
import { totalsOf, type StatsTotals } from './totals.js';

export type StatsFormat = 'text' | 'json';

export const DEFAULT_LIMIT = 10;
export const DEFAULT_HISTORY_LIMIT = 100;

export interface StatsRequest {
  root: string;
  session?: string;
  sinceMs?: number | null;
  limit?: number;
  history?: boolean;
  format: StatsFormat;
  /** Test hook: where Claude Code transcripts live (default `~/.claude/projects`). */
  projectsRoot?: string;
}

export interface StatsReport {
  project_root: string;
  mode: 'recent' | 'session' | 'history';
  sessions: Array<AgentSessionStats & { with_flowlens?: boolean }>;
  totals: StatsTotals;
  comparison: (Comparison & { reading: string; caveat: string }) | null;
  notes: string[];
}

const ok = (stdout: string): AgentCommandResult => ({ exit_code: 0, stdout, stderr: '' });

function render(report: StatsReport, format: StatsFormat, text: () => string): AgentCommandResult {
  return ok(format === 'json' ? JSON.stringify(report, null, 2) : text());
}

const classifyByCalls = (sessions: readonly AgentSessionStats[]): ClassifiedSession[] =>
  sessions.map((stats) => ({ stats, with_flowlens: stats.flowlens_calls > 0 }));

function withReading(c: Comparison): StatsReport['comparison'] {
  return { ...c, reading: readingOf(c), caveat: COMPARISON_CAVEAT };
}

function codexNotes(sessions: readonly AgentSessionStats[]): string[] {
  return sessions.some((s) => s.provider === 'codex') ? [CODEX_NOTE] : [];
}

export async function runAgentStats(req: StatsRequest): Promise<AgentCommandResult> {
  const flowlensDir = join(req.root, '.flowlens');
  if (req.session) return runSession(req, flowlensDir);
  if (req.history) return runHistory(req, flowlensDir);
  return runRecent(req, flowlensDir);
}

async function runRecent(req: StatsRequest, flowlensDir: string): Promise<AgentCommandResult> {
  const limit = req.limit ?? DEFAULT_LIMIT;
  const sessions = await loadLedgerSessions(flowlensDir, { sinceMs: req.sinceMs, limit });
  const anyLedger = sessions.length > 0 || (await listLedgerSessions(flowlensDir)).length > 0;
  const comparison = compareGroups(classifyByCalls(sessions));
  const report: StatsReport = {
    project_root: req.root,
    mode: 'recent',
    sessions,
    totals: totalsOf(sessions),
    comparison: sessions.length ? withReading(comparison) : null,
    notes: sessions.length ? codexNotes(sessions) : anyLedger ? [] : [START_COLLECTING],
  };
  return render(report, req.format, () => {
    if (sessions.length === 0) {
      return anyLedger ? 'No sessions in that time range. Try a longer --since, or run without it.' : START_COLLECTING;
    }
    return [
      `FlowLens agent stats for ${basename(req.root)}: the last ${sessions.length} session${sessions.length === 1 ? '' : 's'}, newest first.`,
      '',
      ...sessions.map(sessionLine),
      '',
      totalsLine(report.totals),
      legend(),
      '',
      readingBlock(comparison),
      ...(comparison.without_transcript ? [`${comparison.without_transcript} session(s) had no readable transcript, so they have no search or token figures.`] : []),
      ...report.notes,
    ].join('\n');
  });
}

async function runSession(req: StatsRequest, flowlensDir: string): Promise<AgentCommandResult> {
  const wanted = req.session!;
  const ids = (await listLedgerSessions(flowlensDir)).map((r) => r.session_id);
  const exact = ids.find((id) => id === wanted);
  const matches = exact ? [exact] : ids.filter((id) => id.startsWith(wanted));
  if (matches.length > 1) {
    return { exit_code: 2, stdout: '', stderr: `flowlens agent: "${wanted}" matches ${matches.length} sessions (${matches.slice(0, 5).join(', ')}). Give more of the id.` };
  }
  let stats: AgentSessionStats | null = null;
  if (matches.length === 1) stats = await loadSessionStats(flowlensDir, matches[0]!);
  else {
    // not in the event log: fall back to the Claude Code transcript with that id
    const file = await findClaudeTranscript(req.root, wanted, req.projectsRoot);
    stats = file ? (await sessionFromTranscript(file, flowlensDir, false))?.stats ?? null : null;
  }
  if (!stats) {
    return { exit_code: 1, stdout: '', stderr: `flowlens agent: no session "${wanted}" in the FlowLens event log or in this project's Claude Code history. List recent sessions with: flowlens agent stats` };
  }
  const report: StatsReport = {
    project_root: req.root, mode: 'session', sessions: [stats], totals: totalsOf([stats]), comparison: null, notes: codexNotes([stats]),
  };
  return render(report, req.format, () => [sessionDetail(stats!), ...report.notes].join('\n'));
}

async function runHistory(req: StatsRequest, flowlensDir: string): Promise<AgentCommandResult> {
  const limit = req.limit ?? DEFAULT_HISTORY_LIMIT;
  const scan = await scanClaudeHistory({ projectRoot: req.root, flowlensDir, sinceMs: req.sinceMs, limit, projectsRoot: req.projectsRoot });
  const comparison = compareGroups(scan.sessions);
  const sessions = scan.sessions.map((c) => ({ ...c.stats, with_flowlens: c.with_flowlens }));
  const report: StatsReport = {
    project_root: req.root,
    mode: 'history',
    sessions,
    totals: totalsOf(scan.sessions.map((c) => c.stats)),
    comparison: scan.sessions.length ? withReading(comparison) : null,
    notes: [CODEX_NOTE],
  };
  return render(report, req.format, () => {
    if (scan.dirs.length === 0) {
      return `No Claude Code history found for ${req.root} (looked for a folder named ${'`'}${claudeProjectDirName(req.root)}${'`'} under ${claudeProjectsRoot()}).\n${CODEX_NOTE}`;
    }
    if (scan.sessions.length === 0) return `Found ${scan.files_found} Claude Code transcript(s), none readable in that time range.\n${CODEX_NOTE}`;
    return [
      `Claude Code history for ${basename(req.root)}: ${scan.sessions.length} session${scan.sessions.length === 1 ? '' : 's'} (newest first${scan.files_found > scan.sessions.length ? `, of ${scan.files_found} found` : ''}).`,
      `With FlowLens = the agent called a FlowLens tool, or this project has a FlowLens event log for the session. ${comparison.with_sessions} of ${comparison.total_sessions} qualify.`,
      '',
      comparisonTable(comparison),
      '',
      readingBlock(comparison),
      legend(),
      CODEX_NOTE,
    ].join('\n');
  });
}
