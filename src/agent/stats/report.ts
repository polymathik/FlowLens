/** Plain-language text for `flowlens agent stats`. No jargon: "steps", "searches", "edit checks". */
import type { AgentSessionStats } from '../../contracts/agent-setup.js';
import { COMPARISON_CAVEAT, readingOf, type Comparison, type GroupAverages } from './compare.js';
import type { StatsTotals } from './totals.js';

export const CODEX_NOTE = 'Codex transcripts are not supported yet: Codex sessions show FlowLens activity only (no search or token figures).';
export const START_COLLECTING = [
  'No FlowLens agent activity has been recorded for this project yet.',
  'To start collecting: flowlens agent install claude-code   (Codex: flowlens agent install codex)',
  'Then use your agent as usual and run flowlens agent stats again.',
  'To look at past Claude Code sessions without the log: flowlens agent stats --history',
].join('\n');

export function compact(n: number): string {
  const v = Math.round(n);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(v);
}

function when(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '????-??-?? ??:??';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const tokensOf = (t: { input: number; output: number; cache_read: number; cache_write: number }): string =>
  `${compact(t.input)} in / ${compact(t.output)} out / ${compact(t.cache_read + t.cache_write)} cached`;

export function sessionLine(s: AgentSessionStats): string {
  const searches = s.transcript ? String(s.transcript.search_calls) : 'n/a';
  const tokens = s.transcript ? tokensOf(s.transcript.tokens) : 'n/a';
  return [
    when(s.started),
    s.session_id.slice(0, 8).padEnd(8),
    `FlowLens calls ${String(s.flowlens_calls).padStart(3)}`,
    `searches ${searches.padStart(3)}`,
    `edits blocked ${s.gate.deny}`,
    `tokens ${tokens}`,
  ].join('  ');
}

export function totalsLine(t: StatsTotals): string {
  const searches = t.with_transcript > 0 ? `${t.search_calls} searches` : 'no transcripts read';
  const tokens = t.with_transcript > 0 ? `, tokens ${tokensOf(t.tokens)}` : '';
  return `Total: ${t.sessions} session${t.sessions === 1 ? '' : 's'}, ${t.flowlens_calls} FlowLens calls, ${searches}, ${t.gate.deny} edits blocked until FlowLens was checked${tokens}.`;
}

export function legend(): string {
  return 'searches = Read + Grep + Glob calls. edits blocked = edits the gate held until FlowLens had been asked about the file.';
}

function row(label: string, a: string, b: string): string {
  return `${label.padEnd(28)}${a.padStart(16)}${b.padStart(18)}`;
}

function cells(g: GroupAverages, pick: (g: GroupAverages) => number, digits = 1): string {
  if (g.sessions === 0) return '-';
  const v = pick(g);
  return v >= 1000 ? compact(v) : v.toFixed(digits).replace(/\.0$/, '');
}

export function comparisonTable(c: Comparison): string {
  const a = c.with_flowlens;
  const b = c.without_flowlens;
  return [
    row('Average per session', 'with FlowLens', 'without FlowLens'),
    row('Sessions', String(a.sessions), String(b.sessions)),
    row('Steps (agent responses)', cells(a, (g) => g.turns), cells(b, (g) => g.turns)),
    row('Searches (Read/Grep/Glob)', cells(a, (g) => g.search_calls), cells(b, (g) => g.search_calls)),
    row('FlowLens calls', cells(a, (g) => g.flowlens_calls), cells(b, (g) => g.flowlens_calls)),
    row('Input tokens', cells(a, (g) => g.input), cells(b, (g) => g.input)),
    row('Output tokens', cells(a, (g) => g.output), cells(b, (g) => g.output)),
    row('Cache read tokens', cells(a, (g) => g.cache_read), cells(b, (g) => g.cache_read)),
    row('Cache write tokens', cells(a, (g) => g.cache_write), cells(b, (g) => g.cache_write)),
  ].join('\n');
}

export function readingBlock(c: Comparison): string {
  return `${readingOf(c)}\n${COMPARISON_CAVEAT}`;
}

const top = (counts: Record<string, number>, n: number): string =>
  Object.entries(counts).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

export function sessionDetail(s: AgentSessionStats): string {
  const lines = [
    `Session ${s.session_id} (${s.provider}), started ${when(s.started)}`,
    `FlowLens calls: ${s.flowlens_calls}${s.flowlens_calls ? ` (${top(s.flowlens_by_tool, 10)})` : ''}`,
    `Context given to the agent: ${s.injections} time${s.injections === 1 ? '' : 's'}, ${compact(s.injected_chars)} characters`,
    `Edit checks: ${s.gate.allow} allowed, ${s.gate.deny} blocked until FlowLens was asked, ${s.gate.relent} let through after repeated blocks`,
    `Post-edit checks run: ${s.guard_runs}`,
  ];
  if (s.transcript) {
    const t = s.transcript;
    lines.push(
      `Agent transcript: ${t.turns} steps, ${t.search_calls} searches (Read/Grep/Glob)`,
      `Tools used: ${top(t.tool_calls, 12)}`,
      `Tokens: ${t.tokens.input} input, ${t.tokens.output} output, ${t.tokens.cache_read} cache read, ${t.tokens.cache_write} cache write`,
    );
  } else {
    lines.push('Agent transcript: not available (search and token figures need it).');
  }
  return lines.join('\n');
}
