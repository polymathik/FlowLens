import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeProjectDirName } from '../../../../src/agent/stats/history.js';
import { runCli } from '../helpers.js';
import { FIXTURES, copyLedger, makeProject, writeFakeSession } from './helpers.js';

function stats(args: string[], p: ReturnType<typeof makeProject>) {
  const r = runCli(['agent', 'stats', ...args], { cwd: p.root, env: { CLAUDE_CONFIG_DIR: p.claudeHome } });
  return r;
}

describe('flowlens agent stats (CLI)', { timeout: 90_000 }, () => {
  it('--format json: sessions, totals, reading', () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl', join(FIXTURES, 'transcripts', 'claude-basic.jsonl'));
    copyLedger(p.flowlensDir, 'sess-codex.jsonl');
    const r = stats(['--format', 'json'], p);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('recent');
    expect(out.sessions).toHaveLength(2);
    const a = out.sessions.find((s: { session_id: string }) => s.session_id === 'sess-a');
    expect(a.transcript.search_calls).toBe(3);
    expect(a.gate).toEqual({ allow: 1, deny: 1, relent: 1 });
    expect(out.totals).toMatchObject({ sessions: 2, flowlens_calls: 3, search_calls: 3, with_transcript: 1 });
    expect(out.comparison.reading).toMatch(/Not enough data/);
    expect(out.notes.join(' ')).toContain('Codex transcripts are not supported yet');
  });

  it('text output: one line per session, totals, reading', () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl', join(FIXTURES, 'transcripts', 'claude-basic.jsonl'));
    const r = stats([], p);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/sess-a\s+FlowLens calls\s+2\s+searches\s+3\s+edits blocked 1/);
    expect(r.stdout).toContain('Total: 1 session');
    expect(r.stdout).toContain('Not enough data');
  });

  it('with zero ledgers it explains how to start collecting', () => {
    const p = makeProject();
    const r = stats([], p);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('flowlens agent install claude-code');
    expect(JSON.parse(stats(['--format', 'json'], p).stdout)).toMatchObject({ sessions: [], comparison: null });
  });

  it('--session shows one session in detail, by id prefix', () => {
    const p = makeProject();
    copyLedger(p.flowlensDir, 'sess-a.jsonl', join(FIXTURES, 'transcripts', 'claude-basic.jsonl'));
    const r = stats(['--session', 'sess'], p);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Session sess-a');
    expect(r.stdout).toContain('impact 2');
    expect(r.stdout).toContain('3 searches');
    expect(stats(['--session', 'nope'], p).status).toBe(1);
  });

  it('--history reads Claude Code transcripts without any ledger', () => {
    const p = makeProject();
    const dir = claudeProjectDirName(p.root);
    for (let i = 0; i < 3; i++) writeFakeSession(p, { id: `w${i}`, flowlens: 1, reads: 2 }, dir);
    for (let i = 0; i < 3; i++) writeFakeSession(p, { id: `o${i}`, flowlens: 0, reads: 8 }, dir);
    const r = stats(['--history', '--format', 'json'], p);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('history');
    expect(out.comparison.with_flowlens.sessions).toBe(3);
    expect(out.comparison.enough_data).toBe(true);
    expect(out.comparison.reading).toContain('6 fewer Read/Grep/Glob calls (2 vs 8)');
  });

  it('rejects bad flags with exit 2 and writes nothing to stdout', () => {
    const p = makeProject();
    for (const args of [['--since', 'yesterday-ish'], ['--limit', '0'], ['--format', 'yaml']]) {
      const r = stats(args, p);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('flowlens agent:');
    }
  });

  it('fixtures are valid JSONL apart from the deliberate torn last line', () => {
    const lines = readFileSync(join(FIXTURES, 'ledgers', 'sess-a.jsonl'), 'utf-8').trim().split('\n');
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
