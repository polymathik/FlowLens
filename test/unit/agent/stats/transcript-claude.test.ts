import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseClaudeTranscript, readClaudeTranscript } from '../../../../src/agent/stats/transcript-claude.js';
import { FIXTURES, makeProject } from './helpers.js';

const BASIC = join(FIXTURES, 'transcripts', 'claude-basic.jsonl');

describe('parseClaudeTranscript', () => {
  const summary = parseClaudeTranscript(readFileSync(BASIC, 'utf-8'));

  it('counts usage once per message id (one response is written as several lines)', () => {
    // msg_1 appears on 4 lines, msg_3 on 2; the torn msg_4 line is ignored
    expect(summary.turns).toBe(3);
    expect(summary.tokens).toEqual({ input: 5, output: 280, cache_read: 4100, cache_write: 500 });
  });

  it('counts each tool call once, by name', () => {
    expect(summary.tool_calls).toEqual({ 'mcp__flowlens__impact': 1, Read: 1, Grep: 1, Glob: 1, Edit: 1 });
    expect(summary.search_calls).toBe(3);
    expect(summary.flowlens_calls).toBe(1);
    expect(summary.flowlens_by_tool).toEqual({ impact: 1 });
  });

  it('counts only human prompts, not tool results, meta, task notifications or compaction summaries', () => {
    expect(summary.prompts).toBe(2);
  });

  it('records the time span', () => {
    expect(summary.first_ts).toBe('2026-10-10T09:00:00.000Z');
    expect(summary.last_ts).toBe('2026-10-10T09:00:08.000Z');
  });

  it('survives garbage and empty input', () => {
    expect(parseClaudeTranscript('')).toMatchObject({ turns: 0, prompts: 0, search_calls: 0 });
    expect(parseClaudeTranscript('not json\n{"type":"assistant"}\n[1,2]\nnull\n')).toMatchObject({ turns: 0 });
  });

  it('takes the largest figure per field when a streamed line carries partial usage', () => {
    const text = [
      { type: 'assistant', message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 2, output_tokens: 5 } } },
      { type: 'assistant', message: { id: 'm', role: 'assistant', content: [], usage: { input_tokens: 2, output_tokens: 90 } } },
    ].map((o) => JSON.stringify(o)).join('\n');
    expect(parseClaudeTranscript(text).tokens.output).toBe(90);
  });
});

describe('readClaudeTranscript', () => {
  it('returns null for a missing file or a directory, never throws', async () => {
    const p = makeProject();
    expect(await readClaudeTranscript(join(p.root, 'nope.jsonl'))).toBeNull();
    expect(await readClaudeTranscript(p.root)).toBeNull();
  });

  it('reads a file that ends in a torn line', async () => {
    const p = makeProject();
    const file = join(p.root, 't.jsonl');
    writeFileSync(file, `${readFileSync(BASIC, 'utf-8')}{"type":"assis`);
    expect((await readClaudeTranscript(file))?.turns).toBe(3);
  });
});
