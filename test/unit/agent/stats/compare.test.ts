import { describe, expect, it } from 'vitest';
import { compareGroups, readingOf, type ClassifiedSession } from '../../../../src/agent/stats/compare.js';
import { emptyStats } from '../../../../src/agent/stats/session-stats.js';
import { parseLimit, parseSince } from '../../../../src/agent/stats/since.js';

function session(id: string, withFlowLens: boolean, searches: number, transcript = true): ClassifiedSession {
  const stats = emptyStats(id);
  stats.flowlens_calls = withFlowLens ? 4 : 0;
  if (transcript) {
    stats.transcript = { path: `/${id}`, turns: 10, tool_calls: {}, search_calls: searches, tokens: { input: 10, output: 20, cache_read: 30, cache_write: 40 } };
  }
  return { stats, with_flowlens: withFlowLens };
}

const group = (n: number, w: boolean, searches: number): ClassifiedSession[] =>
  Array.from({ length: n }, (_, i) => session(`${w ? 'w' : 'o'}${i}`, w, searches));

describe('compareGroups / readingOf', () => {
  it('reports fewer searches when the numbers support it', () => {
    const c = compareGroups([...group(7, true, 10), ...group(3, false, 25)]);
    expect(c.enough_data).toBe(true);
    expect(c.with_flowlens.search_calls).toBe(10);
    expect(readingOf(c)).toBe('FlowLens tools were used in 7/10 sessions; sessions that used them averaged 15 fewer Read/Grep/Glob calls (10 vs 25).');
  });

  it('says more, honestly, when FlowLens sessions searched more', () => {
    const c = compareGroups([...group(3, true, 30), ...group(3, false, 20)]);
    expect(readingOf(c)).toContain('averaged 10 more Read/Grep/Glob calls');
  });

  it('says there is not enough data with fewer than 3 in a group', () => {
    const c = compareGroups([...group(7, true, 10), ...group(2, false, 25)]);
    expect(c.enough_data).toBe(false);
    expect(readingOf(c)).toMatch(/used in 7\/9 sessions\. Not enough data to compare yet/);
    expect(readingOf(c)).not.toMatch(/fewer|more Read/);
  });

  it('sessions without a transcript do not count toward the 3-session minimum', () => {
    const noT = Array.from({ length: 5 }, (_, i) => session(`n${i}`, false, 0, false));
    const c = compareGroups([...group(4, true, 5), ...noT]);
    expect(c.enough_data).toBe(false);
    expect(c.without_transcript).toBe(5);
  });
});

describe('flag parsing', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  it('parses relative and ISO --since', () => {
    expect(parseSince('7d', now)).toBe(now - 7 * 86_400_000);
    expect(parseSince('12h', now)).toBe(now - 12 * 3_600_000);
    expect(parseSince('2026-10-01')).toBe(Date.parse('2026-10-01'));
    expect(parseSince('2026-10-01T10:00:00Z')).toBe(Date.parse('2026-10-01T10:00:00Z'));
  });
  it('rejects nonsense with a usage error', () => {
    expect(() => parseSince('last week')).toThrow(/Invalid --since/);
    expect(() => parseLimit('0')).toThrow(/Invalid --limit/);
    expect(() => parseLimit('abc')).toThrow(/Invalid --limit/);
    expect(parseLimit('25')).toBe(25);
  });
});
