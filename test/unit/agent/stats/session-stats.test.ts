import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLog } from '../../../../src/agent/ledger.js';
import { loadLedgerSessions, loadSessionStats, statsFromEvents } from '../../../../src/agent/stats/session-stats.js';
import { totalsOf } from '../../../../src/agent/stats/totals.js';
import { FIXTURES, copyLedger, makeProject } from './helpers.js';

describe('statsFromEvents', () => {
  const events = parseLog(readFileSync(join(FIXTURES, 'ledgers', 'sess-a.jsonl'), 'utf-8'));

  it('aggregates injections, FlowLens calls (with or without the mcp prefix), gate and guard', () => {
    const s = statsFromEvents('sess-a', events);
    expect(s).toMatchObject({
      provider: 'claude-code',
      started: '2026-10-10T09:00:00.000Z',
      injections: 2,
      injected_chars: 2000,
      flowlens_calls: 2,
      flowlens_by_tool: { impact: 2 },
      gate: { allow: 1, deny: 1, relent: 1 },
      guard_runs: 1,
      transcript: null,
    });
  });

  it('ignores unknown event types and a torn last line', () => {
    expect(events.some((e) => (e as { t: string }).t === 'future-event-type')).toBe(true);
    expect(statsFromEvents('x', events).flowlens_calls).toBe(2);
  });

  it('gives an empty session for no events', () => {
    expect(statsFromEvents('x', [])).toMatchObject({ provider: 'unknown', started: '', flowlens_calls: 0 });
  });
});

describe('loadSessionStats / loadLedgerSessions', () => {
  it('merges the transcript named by the session event', async () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl', join(FIXTURES, 'transcripts', 'claude-basic.jsonl'));
    const s = await loadSessionStats(p.flowlensDir, 'sess-a');
    expect(s.transcript).toMatchObject({ turns: 3, search_calls: 3, tokens: { input: 5, output: 280, cache_read: 4100, cache_write: 500 } });
    expect(s.flowlens_calls).toBe(2); // log says 2, transcript says 1: the larger wins
  });

  it('a missing transcript gives transcript: null, not an error', async () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl', '/does/not/exist.jsonl');
    const s = await loadSessionStats(p.flowlensDir, 'sess-a');
    expect(s.transcript).toBeNull();
    expect(s.flowlens_calls).toBe(2);
  });

  it('does not try to read Codex transcripts', async () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-codex.jsonl');
    const s = await loadSessionStats(p.flowlensDir, 'sess-codex');
    expect(s).toMatchObject({ provider: 'codex', flowlens_calls: 1, transcript: null });
  });

  it('lists sessions newest first, applies since and limit, and totals them', async () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl');
    copyLedger(p.flowlensDir, 'sess-codex.jsonl');
    const all = await loadLedgerSessions(p.flowlensDir);
    expect(all.map((s) => s.session_id).sort()).toEqual(['sess-a', 'sess-codex']);
    expect(await loadLedgerSessions(p.flowlensDir, { limit: 1 })).toHaveLength(1);
    expect(await loadLedgerSessions(p.flowlensDir, { sinceMs: Date.parse('2026-10-11T00:00:00Z') })).toHaveLength(1);
    expect(totalsOf(all)).toMatchObject({ sessions: 2, flowlens_calls: 3, with_transcript: 0, gate: { deny: 1 } });
  });

  it('works with no ledger directory at all', async () => {
    expect(await loadLedgerSessions('/nonexistent/.flowlens')).toEqual([]);
  });
});
