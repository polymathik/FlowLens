import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installClaudeCodeHooks,
  isFlowLensHook,
  uninstallClaudeCodeHooks,
} from '../../../src/agent/claude-code.js';
import { ClaudeSettingsError } from '../../../src/agent/settings-file.js';
import { defaultHookBaseCommand, resolveCliEntry } from '../../../src/agent/hook-command.js';
import { REPO_ROOT } from './helpers.js';

describe('Claude Code settings safety', () => {
  let tmp: string;
  let settingsPath: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'flowlens-settings-'));
    settingsPath = join(tmp, '.claude', 'settings.json');
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function writeSettings(content: string): Promise<void> {
    await mkdir(join(tmp, '.claude'), { recursive: true });
    await writeFile(settingsPath, content);
  }
  const read = async () => JSON.parse(await readFile(settingsPath, 'utf-8'));
  const backups = async () => (await readdir(join(tmp, '.claude'))).filter((f) => f.includes('flowlens-backup'));

  it('refuses to overwrite unparseable JSON and leaves it untouched', async () => {
    const broken = '{ "permissions": { "allow": ["Bash(ls)"] }, // trailing comment\n';
    await writeSettings(broken);
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true }))
      .rejects.toMatchObject({ name: 'ClaudeSettingsError', code: 'invalid_json' });
    await expect(uninstallClaudeCodeHooks(tmp)).rejects.toBeInstanceOf(ClaudeSettingsError);
    expect(await readFile(settingsPath, 'utf-8')).toBe(broken);
    expect(await backups()).toEqual([]);
  });

  it('normalises "hooks": null safely but refuses non-array event groups', async () => {
    await writeSettings(JSON.stringify({ model: 'opus', hooks: null }));
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true });
    expect(result.hooks_added).toBe(5);
    expect((await read()).model).toBe('opus');

    await writeSettings(JSON.stringify({ hooks: { Stop: { command: 'x' } } }));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
    await writeSettings(JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: 'nope' }] } }));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
    await writeSettings(JSON.stringify(['not', 'an', 'object']));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
  });

  it('writes a timestamped backup before modifying and preserves unrelated settings and key order', async () => {
    const original = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
      env: { A: '1' },
    };
    await writeSettings(JSON.stringify(original, null, 2));
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true });

    expect(result.backup_path).toMatch(/settings\.json\.flowlens-backup-\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(await readFile(result.backup_path!, 'utf-8'))).toEqual(original);
    const content = await read();
    expect(Object.keys(content)).toEqual(['permissions', 'hooks', 'env']);
    expect(content.hooks.Stop).toEqual(original.hooks.Stop);
    expect(content.permissions).toEqual(original.permissions);
    expect(await readFile(settingsPath, 'utf-8')).toMatch(/^\{\n {2}"permissions"/);
    expect((await readdir(join(tmp, '.claude'))).some((f) => f.includes('flowlens-tmp'))).toBe(false);
  });

  it('is idempotent: a second install changes nothing and writes no backup', async () => {
    await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true });
    const before = await readFile(settingsPath, 'utf-8');
    const second = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true });
    expect(second).toMatchObject({ hooks_added: 0, hooks_existing: 5 });
    expect(second.backup_path).toBeUndefined();
    expect(await readFile(settingsPath, 'utf-8')).toBe(before);
  });

  it('round-trips a custom --command: install then uninstall removes every FlowLens hook', async () => {
    const command = 'npx --yes tsx /opt/flowlens/src/cli/index.ts';
    await writeSettings(JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
    }));
    const installed = await installClaudeCodeHooks({ project_dir: tmp, command, shared: true });
    expect(installed.hooks_added).toBe(5);
    const content = await read();
    // The user's own PostToolUse group (a different matcher) is untouched; ours are separate groups.
    expect(content.hooks.PostToolUse[0].hooks.map((h: { command: string }) => h.command)).toEqual(['prettier --write']);
    expect(content.hooks.PostToolUse[1].hooks.map((h: { command: string }) => h.command))
      .toEqual([`${command} agent guard --hook --reindex --strict --root "\${CLAUDE_PROJECT_DIR}" # flowlens-managed:guard`]);

    const removed = await uninstallClaudeCodeHooks(tmp);
    expect(removed.hooks_removed).toBe(5);
    expect(removed.backup_path).toBeDefined();
    expect((await read()).hooks).toEqual({
      PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
    });
  });

  it('refreshes marked hooks whose base command changed, without --force (review M3)', async () => {
    // Before Phase 12 the second install kept 'old-flowlens' (a moved install left
    // hooks pointing at a dead path until --force).
    await installClaudeCodeHooks({ project_dir: tmp, command: 'old-flowlens', shared: true });
    const refreshed = await installClaudeCodeHooks({ project_dir: tmp, command: 'new-flowlens', shared: true });
    expect(refreshed).toMatchObject({ hooks_added: 0, hooks_existing: 0, hooks_replaced: 5 });
    const text = JSON.stringify(await read());
    expect(text).not.toContain('old-flowlens');
    expect(text.match(/flowlens-managed/g)).toHaveLength(5);

    const same = await installClaudeCodeHooks({ project_dir: tmp, command: 'new-flowlens', shared: true });
    expect(same).toMatchObject({ hooks_existing: 5, hooks_replaced: 0 });
    expect(same.backup_path).toBeUndefined();
    const forced = await installClaudeCodeHooks({ project_dir: tmp, command: 'new-flowlens', force: true, shared: true });
    expect(forced.hooks_replaced).toBe(5);
    expect(JSON.stringify(await read()).match(/flowlens-managed/g)).toHaveLength(5);
  });

  it('migrates legacy unmarked hooks (old regex shape) instead of duplicating them', async () => {
    await writeSettings(JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: 'flowlens agent context --hook --event session_start', timeout: 10 }] }],
        UserPromptSubmit: [{ hooks: [
          { type: 'command', command: 'node ./bin/fl.js agent context --hook --event prompt_submit', timeout: 10 },
          { type: 'command', command: 'echo user-hook' },
        ] }],
        PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: 'flowlens agent guard --hook --reindex --strict', timeout: 20 }] }],
      },
    }));
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens', shared: true });
    expect(result).toMatchObject({ hooks_added: 2, hooks_replaced: 3 });
    const content = await read();
    const all = Object.values(content.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
    expect(all.filter((c) => c.includes('agent '))).toHaveLength(5);
    expect(all.every((c) => !c.includes('agent ') || /# flowlens-managed:(context|guard|gate|record)$/.test(c))).toBe(true);
    expect(all).toContain('echo user-hook');
    expect(content.hooks.SessionStart).toHaveLength(1);
    expect(content.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact');
  });

  it('uninstall without a settings file creates nothing', async () => {
    const result = await uninstallClaudeCodeHooks(tmp);
    expect(result).toMatchObject({ hooks_removed: 0, settings_found: false });
    expect(existsSync(join(tmp, '.claude'))).toBe(false);
  });

  it('recognises marked and legacy hooks but not unrelated ones', () => {
    expect(isFlowLensHook({ command: 'anything # flowlens-managed' })).toBe(true);
    expect(isFlowLensHook({ command: 'npx fl agent guard --hook' })).toBe(true);
    expect(isFlowLensHook({ command: 'eslint --fix' })).toBe(false);
    expect(isFlowLensHook({ command: 42 })).toBe(false);
  });

  it('defaults the hook command to node + this package dist entry (no global install)', () => {
    expect(resolveCliEntry()).toBe(join(REPO_ROOT, 'dist', 'cli', 'index.js'));
    expect(defaultHookBaseCommand()).toBe(`node "${join(REPO_ROOT, 'dist', 'cli', 'index.js')}"`);
  });
});

describe('settings file scope (review M3)', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'flowlens-scope-')));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });
  const readJson = async (rel: string) => JSON.parse(await readFile(join(tmp, rel), 'utf-8'));
  const gitInit = () => execFileSync('git', ['init', '-q'], { cwd: tmp });

  it('defaults to .claude/settings.local.json and keeps it out of git', async () => {
    gitInit();
    const result = await installClaudeCodeHooks({ project_dir: tmp });
    expect(result.scope).toBe('local');
    expect(result.settings_path).toBe(join(tmp, '.claude', 'settings.local.json'));
    expect(existsSync(join(tmp, '.claude', 'settings.json'))).toBe(false);
    expect(JSON.stringify(await readJson('.claude/settings.local.json'))).toContain('flowlens-managed');
    expect(result.git_ignored_via).toMatch(/info[/\\]exclude$/);
    // git now ignores it, and a second install does not append the pattern twice
    execFileSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: tmp });
    await installClaudeCodeHooks({ project_dir: tmp });
    const exclude = await readFile(join(tmp, '.git', 'info', 'exclude'), 'utf-8');
    expect(exclude.match(/settings\.local\.json/g)).toHaveLength(1);
  });

  it('--shared uses the portable npx command when FlowLens is a project dependency', async () => {
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ devDependencies: { flowlens: '^0.1.0' } }));
    await mkdir(join(tmp, 'node_modules', '.bin'), { recursive: true });
    await writeFile(join(tmp, 'node_modules', '.bin', 'flowlens'), '#!/bin/sh\n');
    const result = await installClaudeCodeHooks({ project_dir: tmp, shared: true });
    expect(result).toMatchObject({ scope: 'shared', command: 'npx --no-install flowlens' });
    expect(result.warnings).toBeUndefined();
    const guard = (await readJson('.claude/settings.json')).hooks.PostToolUse[0].hooks[0].command as string;
    expect(guard.startsWith('npx --no-install flowlens agent guard')).toBe(true);
  });

  it('--shared warns when the command embeds an absolute path', async () => {
    const result = await installClaudeCodeHooks({ project_dir: tmp, shared: true });
    expect(result.command).toMatch(/^node "\//);
    expect(result.warnings?.[0]).toMatch(/absolute path/);
  });

  it('a local install moves machine-specific FlowLens hooks out of the shared file; uninstall checks both', async () => {
    await installClaudeCodeHooks({ project_dir: tmp, shared: true, command: 'node "/old/place/dist/cli/index.js"' });
    const shared = await readJson('.claude/settings.json');
    shared.hooks.Stop = [{ hooks: [{ type: 'command', command: 'say done' }] }];
    await writeFile(join(tmp, '.claude', 'settings.json'), JSON.stringify(shared));

    const local = await installClaudeCodeHooks({ project_dir: tmp, command: 'node "/new/place/dist/cli/index.js"' });
    expect(local).toMatchObject({ scope: 'local', hooks_added: 5, hooks_moved: 5, moved_from: join(tmp, '.claude', 'settings.json') });
    expect((await readJson('.claude/settings.json')).hooks).toEqual({ Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });

    // Portable shared hooks are left alone, with a warning.
    await installClaudeCodeHooks({ project_dir: tmp, shared: true, command: 'npx --no-install flowlens' });
    const both = await installClaudeCodeHooks({ project_dir: tmp, command: 'node "/new/place/dist/cli/index.js"' });
    expect(both.hooks_moved).toBeUndefined();
    expect(both.warnings?.join(' ')).toMatch(/portable FlowLens hook/);

    // (the --shared install in between moved the earlier local hooks out of settings.local.json)
    const removed = await uninstallClaudeCodeHooks(tmp);
    expect(removed.hooks_removed).toBe(10);
    expect(removed.files?.map((f) => [f.path.endsWith('settings.local.json') ? 'local' : 'shared', f.hooks_removed]))
      .toEqual([['local', 5], ['shared', 5]]);
    expect((await readJson('.claude/settings.json')).hooks).toEqual({ Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
  });
});
