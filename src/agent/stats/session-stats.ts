/**
 * Per-session statistics: the FlowLens event log (what the hooks recorded) plus, when the agent's own
 * transcript can be read, what the agent actually did. Pure aggregation; IO is `loadLedgerSessions`.
 */
import {
  FLOWLENS_TOOL_PREFIX,
  type AgentLogEvent,
  type AgentProviderId,
  type AgentSessionStats,
} from '../../contracts/agent-setup.js';
import { listLedgerSessions, readSessionLog } from '../ledger.js';
import { readClaudeTranscript, toTranscriptStats, type ClaudeTranscriptSummary } from './transcript-claude.js';

/** `FlowLens` tool name without the `mcp__flowlens__` prefix. */
export function bareToolName(tool: string): string {
  return tool.startsWith(FLOWLENS_TOOL_PREFIX) ? tool.slice(FLOWLENS_TOOL_PREFIX.length) : tool;
}

export function emptyStats(sessionId: string): AgentSessionStats {
  return {
    session_id: sessionId,
    provider: 'unknown',
    started: '',
    injections: 0,
    injected_chars: 0,
    flowlens_calls: 0,
    flowlens_by_tool: {},
    gate: { allow: 0, deny: 0, relent: 0 },
    guard_runs: 0,
    transcript: null,
  };
}

/** Where the agent's transcript is, as recorded by the `session` event (last one wins). */
export function transcriptPathOf(events: readonly AgentLogEvent[]): { provider: AgentProviderId | null; path: string | null } {
  let provider: AgentProviderId | null = null;
  let path: string | null = null;
  for (const e of events) {
    if (e.t !== 'session') continue;
    provider = e.provider;
    if (e.transcript_path) path = e.transcript_path;
  }
  return { provider, path };
}

/** Aggregate one session's event log. Unknown event types are ignored. */
export function statsFromEvents(sessionId: string, events: readonly AgentLogEvent[]): AgentSessionStats {
  const stats = emptyStats(sessionId);
  let earliest = '';
  for (const e of events) {
    if (typeof e.ts === 'string' && (earliest === '' || e.ts < earliest)) earliest = e.ts;
    switch (e.t) {
      case 'session':
        stats.provider = e.provider;
        break;
      case 'inject':
        stats.injections++;
        stats.injected_chars += Number.isFinite(e.chars) ? e.chars : 0;
        break;
      case 'query': {
        const name = bareToolName(e.tool);
        stats.flowlens_calls++;
        stats.flowlens_by_tool[name] = (stats.flowlens_by_tool[name] ?? 0) + 1;
        break;
      }
      case 'gate':
        if (e.decision === 'allow' || e.decision === 'deny' || e.decision === 'relent') stats.gate[e.decision]++;
        break;
      case 'guard':
        stats.guard_runs++;
        break;
      default:
        break; // unknown event type: ignored by contract
    }
  }
  stats.started = earliest;
  return stats;
}

/**
 * Add the transcript to a session. FlowLens calls are the larger of the two counts per tool: the log can
 * miss calls made before the hooks were installed, the transcript can be missing or from another agent.
 */
export function withTranscript(stats: AgentSessionStats, path: string, summary: ClaudeTranscriptSummary): AgentSessionStats {
  const byTool = { ...stats.flowlens_by_tool };
  for (const [tool, count] of Object.entries(summary.flowlens_by_tool)) byTool[tool] = Math.max(byTool[tool] ?? 0, count);
  return {
    ...stats,
    started: stats.started || summary.first_ts || '',
    flowlens_by_tool: byTool,
    flowlens_calls: Object.values(byTool).reduce((a, b) => a + b, 0),
    transcript: toTranscriptStats(path, summary),
  };
}

/** Build one session from the event log (and its transcript when readable). Never throws. */
export async function loadSessionStats(flowlensDir: string, sessionId: string): Promise<AgentSessionStats> {
  const events = await readSessionLog(flowlensDir, sessionId);
  const stats = statsFromEvents(sessionId, events);
  const { provider, path } = transcriptPathOf(events);
  if (path && (provider === 'claude-code' || provider === null)) {
    const summary = await readClaudeTranscript(path);
    if (summary) return withTranscript(stats, path, summary);
  }
  return stats;
}

/** All sessions with a ledger, newest first, optionally filtered by start time and capped. */
export async function loadLedgerSessions(
  flowlensDir: string,
  opts: { sinceMs?: number | null; limit?: number } = {},
): Promise<AgentSessionStats[]> {
  const rows = await listLedgerSessions(flowlensDir);
  const out: AgentSessionStats[] = [];
  for (const row of rows) {
    if (opts.sinceMs != null && row.mtime_ms < opts.sinceMs) continue; // untouched since: cannot be in range
    const stats = await loadSessionStats(flowlensDir, row.session_id);
    const startedMs = Date.parse(stats.started);
    if (opts.sinceMs != null && (Number.isFinite(startedMs) ? startedMs : row.mtime_ms) < opts.sinceMs) continue;
    out.push(stats);
    if (opts.limit != null && out.length >= opts.limit) break;
  }
  return out;
}
