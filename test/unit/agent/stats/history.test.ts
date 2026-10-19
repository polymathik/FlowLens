import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeProjectDirName, claudeProjectsRoot, findClaudeProjectDirs, findClaudeTranscript, scanClaudeHistory,
} from '../../../../src/agent/stats/history.js';
import { runAgentStats } from '../../../../src/agent/stats/run-stats.js';
import { makeProject, writeFakeSession } from './helpers.js';

describe('Claude Code project directory', () => {
  it('replaces every non-alphanumeric character with "-"', () => {
    expect(claudeProjectDirName('/home/claude')).toBe('-home-claude');
    expect(claudeProjectDirName('/Users/Sai Lalith/my.proj_x')).toBe('-Users-Sai-Lalith-my-proj-x');
    expect(claudeProjectDirName('C:\\dev\\app')).toBe('C--dev-app');
  });

  it('honours CLAUDE_CONFIG_DIR', () => {
    expect(claudeProjectsRoot({ CLAUDE_CONFIG_DIR: '/x/cfg' }, '/home/u')).toBe('/x/cfg/projects');
    expect(claudeProjectsRoot({}, '/home/u')).toBe('/home/u/.claude/projects');
  });

  it('finds the directory, and none when absent', async () => {
    const p = makeProject();
    expect(await findClaudeProjectDirs(p.root, p.projectsRoot)).toEqual([]);
    const name = claudeProjectDirName(p.root);
    mkdirSync(join(p.projectsRoot, name));
    expect(await findClaudeProjectDirs(p.root, p.projectsRoot)).toEqual([join(p.projectsRoot, name)]);
  });
});

describe('scanClaudeHistory', () => {
  function setup() {
    const p = makeProject();
    const dir = claudeProjectDirName(p.root);
    // 4 sessions that called FlowLens (searches 5), 3 without (searches 20), 1 with only a ledger
    for (let i = 0; i < 4; i++) writeFakeSession(p, { id: `with-${i}`, flowlens: 2, reads: 5 }, dir);
    for (let i = 0; i < 3; i++) writeFakeSession(p, { id: `without-${i}`, flowlens: 0, reads: 20 }, dir);
    writeFakeSession(p, { id: 'ledger-only', flowlens: 0, reads: 9, ledger: true }, dir);
    return { p, dir };
  }

  it('classifies sessions by FlowLens tool calls or an existing ledger', async () => {
    const { p } = setup();
    const scan = await scanClaudeHistory({ projectRoot: p.root, flowlensDir: p.flowlensDir, limit: 100, projectsRoot: p.projectsRoot });
    expect(scan.sessions).toHaveLength(8);
    const withIds = scan.sessions.filter((s) => s.with_flowlens).map((s) => s.stats.session_id).sort();
    expect(withIds).toEqual(['ledger-only', 'with-0', 'with-1', 'with-2', 'with-3']);
  });

  it('applies --limit', async () => {
    const { p } = setup();
    const scan = await scanClaudeHistory({ projectRoot: p.root, flowlensDir: p.flowlensDir, limit: 3, projectsRoot: p.projectsRoot });
    expect(scan.sessions).toHaveLength(3);
    expect(scan.files_found).toBe(8);
  });

  it('finds a session by unique id prefix', async () => {
    const { p } = setup();
    expect((await findClaudeTranscript(p.root, 'ledger-', p.projectsRoot))?.id).toBe('ledger-only');
    expect(await findClaudeTranscript(p.root, 'with-', p.projectsRoot)).toBeNull(); // ambiguous
  });

  it('history report: table, counts, the reading and the caveat', async () => {
    const { p } = setup();
    const r = await runAgentStats({ root: p.root, history: true, format: 'text', projectsRoot: p.projectsRoot });
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toContain('with FlowLens');
    expect(r.stdout).toContain('without FlowLens');
    expect(r.stdout).toMatch(/Searches \(Read\/Grep\/Glob\)\s+5\.8\s+20/); // (4*5+9)/5 vs 20
    expect(r.stdout).toContain('averaged');
    expect(r.stdout).toContain('signal, not proof');
    expect(r.stdout).toContain('Codex transcripts are not supported yet');
  });

  it('history with no Claude Code folder says so instead of failing', async () => {
    const p = makeProject();
    const r = await runAgentStats({ root: p.root, history: true, format: 'text', projectsRoot: p.projectsRoot });
    expect(r.exit_code).toBe(0);
    expect(r.stdout).toContain('No Claude Code history found');
  });
});
