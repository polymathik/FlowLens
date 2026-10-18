/**
 * End-to-end: real temp project → `flowlens init/index` → `agent install
 * claude-code` → run the INSTALLED hook command strings through `sh -c`
 * (Claude Code's shell form) with real hook JSON on stdin and
 * CLAUDE_PROJECT_DIR set → assert on the hook JSON Claude Code would read.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LevelGraphStore } from '../../../src/graph/levelgraph-store.js';
import type { ClaudeHookOutput, ClaudeSettings } from '../../../src/contracts/agent.js';
import { git, runCli, runHookCommand, TSX_CLI_COMMAND } from './helpers.js';

const E2E_TIMEOUT = 180000;

describe('agent hooks end to end', () => {
  let proj: string;
  let elsewhere: string;
  let commands: { session: string; prompt: string; guard: string };
  // $FLOWLENS_HOME is a per-file temp dir (test/setup/flowlens-home.ts): the
  // CLI and hook children inherit it, auto-start their own daemon there
  // (never a user-level one that may run older code), and the setup's
  // afterAll stops it. An in-process daemon would not work here: spawnSync
  // blocks this worker so it could not answer pings.
  const env = () => ({ CLAUDE_PROJECT_DIR: proj });
  const parse = (stdout: string) => JSON.parse(stdout) as ClaudeHookOutput;
  const postToolUse = (file: string) => ({
    hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: proj,
    tool_input: { file_path: join(proj, file) }, tool_response: { filePath: join(proj, file) },
  });

  beforeAll(async () => {
    proj = await mkdtemp(join(tmpdir(), 'flowlens-e2e-'));
    elsewhere = await mkdtemp(join(tmpdir(), 'flowlens-e2e-cwd-'));
    await mkdir(join(proj, 'src'));
    // Extensionless imports: `.js`-suffixed resolution is Lane A's fix.
    await writeFile(join(proj, 'src/a.ts'), "import { b } from './b';\nexport function alpha() { return b(); }\n");
    await writeFile(join(proj, 'src/b.ts'), "import { alpha } from './a';\nexport function b() { return 1; }\nexport function useAlpha() { return alpha(); }\n");
    await writeFile(join(proj, 'src/c.ts'), 'export function gamma() { return 3; }\n');
    await writeFile(join(proj, 'src/d.ts'), 'export function delta() { return 4; }\n');
    git(proj, ['init', '-q']);
    git(proj, ['add', '-A']);
    git(proj, ['commit', '-qm', 'init']);
    expect(runCli(['init'], { cwd: proj }).status).toBe(0);
    expect(runCli(['index'], { cwd: proj }).status).toBe(0);

    const install = runCli(['agent', 'install', 'claude-code', '--command', TSX_CLI_COMMAND, '--format', 'json'], { cwd: proj });
    expect(install.status).toBe(0);
    const settings = JSON.parse(await readFile(join(proj, '.claude/settings.json'), 'utf-8')) as ClaudeSettings;
    commands = {
      session: settings.hooks!.SessionStart[0].hooks[0].command,
      prompt: settings.hooks!.UserPromptSubmit[0].hooks[0].command,
      guard: settings.hooks!.PostToolUse[0].hooks[0].command,
    };
    expect(commands.guard).toContain('--root "${CLAUDE_PROJECT_DIR}"');
    expect(settings.hooks!.UserPromptSubmit[0].hooks[0].timeout).toBe(15);
  }, E2E_TIMEOUT);

  afterAll(async () => {
    await rm(proj, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it('SessionStart injects context and records the baseline (root from $CLAUDE_PROJECT_DIR)', () => {
    const run = runHookCommand(commands.session, { hook_event_name: 'SessionStart', source: 'startup', cwd: elsewhere }, env(), elsewhere);
    expect(run.status).toBe(0);
    const out = parse(run.stdout);
    expect(out.hookSpecificOutput?.hookEventName).toBe('SessionStart');
    expect(out.hookSpecificOutput?.additionalContext).toContain('FlowLens Agent Context');
    expect(out.hookSpecificOutput?.additionalContext).toContain('src/a.ts -> src/b.ts');
    expect(existsSync(join(proj, '.flowlens/agent-baseline.json'))).toBe(true);
    expect(existsSync(join(proj, '.flowlens/agent-digest.json'))).toBe(true);
  }, E2E_TIMEOUT);

  it('UserPromptSubmit injects prompt-relevant files', () => {
    const run = runHookCommand(commands.prompt, { hook_event_name: 'UserPromptSubmit', prompt: 'make gamma faster', cwd: proj }, env(), proj);
    expect(run.status).toBe(0);
    const out = parse(run.stdout);
    expect(out.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput?.additionalContext).toContain('src/c.ts');
  }, E2E_TIMEOUT);

  it('PostToolUse on a file in a pre-existing cycle reports context but does not block', async () => {
    await appendFile(join(proj, 'src/a.ts'), '// touched\n');
    const run = runHookCommand(commands.guard, postToolUse('src/a.ts'), env(), proj);
    expect(run.status).toBe(0);
    const out = parse(run.stdout);
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput?.additionalContext).toContain('Pre-existing cycles touching changes');
  }, E2E_TIMEOUT);

  it('PostToolUse blocks (decision: block) only when the edit introduces a new cycle', async () => {
    await writeFile(join(proj, 'src/c.ts'), "import { delta } from './d';\nexport function gamma() { return delta(); }\n");
    const first = runHookCommand(commands.guard, postToolUse('src/c.ts'), env(), proj);
    expect(first.status).toBe(0);
    expect(first.stdout.trim() === '' || parse(first.stdout).decision === undefined).toBe(true);

    await writeFile(join(proj, 'src/d.ts'), "import { gamma } from './c';\nexport function delta() { return gamma(); }\n");
    const second = runHookCommand(commands.guard, postToolUse('src/d.ts'), env(), proj);
    expect(second.status).toBe(0);
    const out = parse(second.stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('1 new cycle');
    expect(out.hookSpecificOutput?.additionalContext).toContain('NEW cycles touching changes');
    expect(out.hookSpecificOutput?.additionalContext).toContain('src/c.ts -> src/d.ts');
  }, E2E_TIMEOUT);

  it('ignores edits to non-source files (no output, no re-index)', () => {
    const run = runHookCommand(commands.guard, postToolUse('.flowlens/config.json'), env(), proj);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe('');
  }, E2E_TIMEOUT);

  it('says so explicitly when another process holds the graph lock', async () => {
    const holder = new LevelGraphStore();
    await holder.open(join(proj, '.flowlens/graph'));
    try {
      const guard = runHookCommand(commands.guard, postToolUse('src/b.ts'), env(), proj);
      expect(guard.status).toBe(0);
      const out = parse(guard.stdout);
      expect(out.decision).toBeUndefined();
      expect(out.hookSpecificOutput?.additionalContext).toMatch(/holds the graph lock.*did NOT check/s);
      expect(out.systemMessage).toContain('strict guard skipped');

      // Context still works from the cached digest (no LevelDB open needed).
      const ctx = runHookCommand(commands.prompt, { hook_event_name: 'UserPromptSubmit', prompt: 'alpha' }, env(), proj);
      expect(parse(ctx.stdout).hookSpecificOutput?.additionalContext).toContain('FlowLens Agent Context');

      await rm(join(proj, '.flowlens/agent-digest.json'));
      const cold = runHookCommand(commands.prompt, { hook_event_name: 'UserPromptSubmit', prompt: 'alpha' }, env(), proj);
      expect(parse(cold.stdout).hookSpecificOutput?.additionalContext).toContain('holds the graph lock');
    } finally {
      await holder.close();
    }
  }, E2E_TIMEOUT);

  it('rejects invalid flag values with exit 2 and a message', () => {
    const event = runCli(['agent', 'context', '--event', 'bogus'], { cwd: proj });
    expect(event.status).toBe(2);
    expect(event.stderr).toContain('Invalid --event "bogus"');
    const max = runCli(['agent', 'guard', '--max-items', 'abc'], { cwd: proj });
    expect(max.status).toBe(2);
    expect(max.stderr).toContain('--max-items');
    expect(runCli(['agent', 'context', '--format', 'yaml'], { cwd: proj }).status).toBe(2);
  }, E2E_TIMEOUT);

  it('refuses to touch malformed settings (exit 2), then uninstalls cleanly', async () => {
    const path = join(proj, '.claude/settings.json');
    const good = await readFile(path, 'utf-8');
    await writeFile(path, '{ broken');
    const bad = runCli(['agent', 'install', 'claude-code'], { cwd: proj });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('not valid JSON');
    expect(await readFile(path, 'utf-8')).toBe('{ broken');

    await writeFile(path, good);
    const removed = runCli(['agent', 'uninstall', 'claude-code', '--format', 'json'], { cwd: proj });
    expect(removed.status).toBe(0);
    expect(JSON.parse(removed.stdout).hooks_removed).toBe(3);
    expect(JSON.parse(await readFile(path, 'utf-8')).hooks).toEqual({});
  }, E2E_TIMEOUT);

  it('returns a setup hint (not a crash) when the project has no graph', () => {
    const ctx = runHookCommand(commands.session, { hook_event_name: 'SessionStart' }, { CLAUDE_PROJECT_DIR: elsewhere }, elsewhere);
    expect(ctx.status).toBe(0);
    expect(parse(ctx.stdout).hookSpecificOutput?.additionalContext).toContain('flowlens init');
  }, E2E_TIMEOUT);
});
