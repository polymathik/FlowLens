import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFilesFromHook, parseHookInput, resolveAgentRoot } from '../../../src/agent/hook-input.js';
import { blockOutput, contextOutput, hookEventNameFor, truncateToBudget } from '../../../src/agent/hook-output.js';
import { AgentUsageError, parseBudget, parseEvent, parseFormat, parseMaxItems, parseRisk } from '../../../src/agent/options.js';
import { getFilteredGitChangedFiles, resolveChangedFiles } from '../../../src/agent/changed-files.js';
import { git } from './helpers.js';

describe('hook input/output', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'flowlens-hookio-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('resolves the root from --root ($CLAUDE_PROJECT_DIR), then hook cwd, then process cwd', async () => {
    await mkdir(join(tmp, 'proj', '.flowlens'), { recursive: true });
    await mkdir(join(tmp, 'proj', 'packages', 'app'), { recursive: true });
    const proj = join(tmp, 'proj');
    expect(resolveAgentRoot(proj, { cwd: '/elsewhere' })).toBe(proj);
    expect(resolveAgentRoot('', { cwd: proj })).toBe(proj);
    expect(resolveAgentRoot('${CLAUDE_PROJECT_DIR}', { cwd: proj })).toBe(proj);
    expect(resolveAgentRoot(undefined, {}, proj)).toBe(proj);
    // subdirectory (e.g. Claude cd'ed into a package) walks up to the indexed root
    expect(resolveAgentRoot(undefined, { cwd: join(proj, 'packages', 'app') })).toBe(proj);
    // no .flowlens anywhere: keep the candidate
    expect(resolveAgentRoot(join(tmp, 'other'), {})).toBe(join(tmp, 'other'));
  });

  it('extracts changed files from Edit/Write/MultiEdit/NotebookEdit input and drops paths outside root', () => {
    const files = changedFilesFromHook({
      tool_name: 'MultiEdit',
      tool_input: { file_path: join(tmp, 'src/a.ts'), edits: [{ file_path: join(tmp, 'src/c.ts') }], notebook_path: join(tmp, 'n.ipynb') },
      tool_response: { filePath: join(tmp, 'src/b.ts') },
    }, tmp);
    expect(files).toEqual(['n.ipynb', 'src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(changedFilesFromHook({ tool_input: { file_path: '/etc/passwd' } }, tmp)).toEqual([]);
  });

  it('parses hook stdin defensively', () => {
    expect(parseHookInput('')).toEqual({});
    expect(parseHookInput('not json')).toEqual({});
    expect(parseHookInput('[1,2]')).toEqual({});
    expect(parseHookInput('{"hook_event_name":"UserPromptSubmit","prompt":"hi"}').prompt).toBe('hi');
  });

  it('builds documented hook JSON shapes', () => {
    expect(contextOutput('PostToolUse', 'findings')).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'findings' },
    });
    expect(blockOutput('new cycle', 'details')).toEqual({
      decision: 'block',
      reason: 'new cycle',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'details' },
    });
    expect(contextOutput('SessionStart', 'x', { systemMessage: 'warn' }).systemMessage).toBe('warn');
    expect(hookEventNameFor('session_start')).toBe('SessionStart');
    expect(hookEventNameFor('prompt_submit')).toBe('UserPromptSubmit');
    expect(hookEventNameFor('prompt_submit', 'SessionStart')).toBe('SessionStart');
  });

  it('truncates to the character budget, below Claude Code\'s 10,000-char cap', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `- line ${i}`).join('\n');
    const cut = truncateToBudget(long, 1000);
    expect(cut.length).toBeLessThanOrEqual(1000);
    expect(cut).toContain('truncated');
    expect(truncateToBudget(long, 50000).length).toBeLessThanOrEqual(9500);
    expect(truncateToBudget('short', 1000)).toBe('short');
  });

  it('validates flag values', () => {
    expect(parseEvent('session_start')).toBe('session_start');
    expect(parseFormat('json')).toBe('json');
    expect(parseMaxItems('12')).toBe(12);
    expect(parseRisk('high')).toBe('high');
    expect(parseBudget('4000')).toBe(4000);
    expect(() => parseEvent('sessionstart')).toThrow(AgentUsageError);
    expect(() => parseFormat('yaml')).toThrow(/Invalid --format "yaml"/);
    expect(() => parseMaxItems('abc')).toThrow(/--max-items/);
    expect(() => parseMaxItems('0')).toThrow(AgentUsageError);
    expect(() => parseMaxItems('3.5')).toThrow(AgentUsageError);
    expect(() => parseBudget('99999')).toThrow(AgentUsageError);
  });
});

describe('git fallback filtering', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'flowlens-gitf-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('applies config exclude, .flowlensignore, .gitignore and supported extensions', async () => {
    git(tmp, ['init', '-q']);
    for (const dir of ['src', '.flowlens/snapshots', 'dist', 'gen', 'tmp', '.claude']) {
      await mkdir(join(tmp, dir), { recursive: true });
    }
    await writeFile(join(tmp, '.flowlens/config.json'), JSON.stringify({ exclude: ['dist/**'], languages: { python: false } }));
    await writeFile(join(tmp, '.flowlensignore'), 'gen/**\n');
    await writeFile(join(tmp, '.gitignore'), 'tmp/*.ts\n');
    const files = {
      'src/keep.ts': 'export const a = 1;',
      'src/skip.py': 'x = 1',
      'README.md': '# hi',
      '.flowlens/snapshots/s1.json': '{}',
      'dist/out.ts': 'export {}',
      'gen/auto.ts': 'export {}',
      'tmp/scratch.ts': 'export {}',
      '.claude/settings.json': '{}',
    };
    for (const [path, content] of Object.entries(files)) await writeFile(join(tmp, path), content);

    expect(await getFilteredGitChangedFiles(tmp)).toEqual(['src/keep.ts']);
    const resolved = await resolveChangedFiles({ explicit: [], hook: [], rootDir: tmp, useGit: true });
    expect(resolved).toEqual({ files: ['src/keep.ts'], source: 'git' });
    expect(await getFilteredGitChangedFiles(join(tmp, 'missing'))).toEqual([]);
  });
});
