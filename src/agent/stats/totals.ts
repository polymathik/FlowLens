import type { AgentSessionStats } from '../../contracts/agent-setup.js';

export interface StatsTotals {
  sessions: number;
  /** Sessions whose transcript was read (search and token figures cover these only). */
  with_transcript: number;
  flowlens_calls: number;
  search_calls: number;
  injections: number;
  injected_chars: number;
  gate: { allow: number; deny: number; relent: number };
  guard_runs: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
}

export function totalsOf(sessions: readonly AgentSessionStats[]): StatsTotals {
  const t: StatsTotals = {
    sessions: sessions.length,
    with_transcript: 0,
    flowlens_calls: 0,
    search_calls: 0,
    injections: 0,
    injected_chars: 0,
    gate: { allow: 0, deny: 0, relent: 0 },
    guard_runs: 0,
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  };
  for (const s of sessions) {
    t.flowlens_calls += s.flowlens_calls;
    t.injections += s.injections;
    t.injected_chars += s.injected_chars;
    t.gate.allow += s.gate.allow;
    t.gate.deny += s.gate.deny;
    t.gate.relent += s.gate.relent;
    t.guard_runs += s.guard_runs;
    if (!s.transcript) continue;
    t.with_transcript++;
    t.search_calls += s.transcript.search_calls;
    t.tokens.input += s.transcript.tokens.input;
    t.tokens.output += s.transcript.tokens.output;
    t.tokens.cache_read += s.transcript.tokens.cache_read;
    t.tokens.cache_write += s.transcript.tokens.cache_write;
  }
  return t;
}
