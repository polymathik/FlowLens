import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' }))
      .rejects.toMatchObject({ name: 'ClaudeSettingsError', code: 'invalid_json' });
    await expect(uninstallClaudeCodeHooks(tmp)).rejects.toBeInstanceOf(ClaudeSettingsError);
    expect(await readFile(settingsPath, 'utf-8')).toBe(broken);
    expect(await backups()).toEqual([]);
  });

  it('normalises "hooks": null safely but refuses non-array event groups', async () => {
    await writeSettings(JSON.stringify({ model: 'opus', hooks: null }));
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });
    expect(result.hooks_added).toBe(3);
    expect((await read()).model).toBe('opus');

    await writeSettings(JSON.stringify({ hooks: { Stop: { command: 'x' } } }));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
    await writeSettings(JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: 'nope' }] } }));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
    await writeSettings(JSON.stringify(['not', 'an', 'object']));
    await expect(installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' }))
      .rejects.toMatchObject({ code: 'invalid_shape' });
  });

  it('writes a timestamped backup before modifying and preserves unrelated settings and key order', async () => {
    const original = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
      env: { A: '1' },
    };
    await writeSettings(JSON.stringify(original, null, 2));
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });

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
    await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });
    const before = await readFile(settingsPath, 'utf-8');
    const second = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });
    expect(second).toMatchObject({ hooks_added: 0, hooks_existing: 3 });
    expect(second.backup_path).toBeUndefined();
    expect(await readFile(settingsPath, 'utf-8')).toBe(before);
  });

  it('round-trips a custom --command: install then uninstall removes every FlowLens hook', async () => {
    const command = 'npx --yes tsx /opt/flowlens/src/cli/index.ts';
    await writeSettings(JSON.stringify({
      hooks: { PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
    }));
    const installed = await installClaudeCodeHooks({ project_dir: tmp, command });
    expect(installed.hooks_added).toBe(3);
    const content = await read();
    expect(content.hooks.PostToolUse[0].hooks.map((h: { command: string }) => h.command))
      .toEqual(['prettier --write', `${command} agent guard --hook --reindex --strict --root "\${CLAUDE_PROJECT_DIR}" # flowlens-managed`]);

    const removed = await uninstallClaudeCodeHooks(tmp);
    expect(removed.hooks_removed).toBe(3);
    expect(removed.backup_path).toBeDefined();
    expect((await read()).hooks).toEqual({
      PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [{ type: 'command', command: 'prettier --write' }] }],
    });
  });

  it('--force replaces marked hooks installed with a different command', async () => {
    await installClaudeCodeHooks({ project_dir: tmp, command: 'old-flowlens' });
    const kept = await installClaudeCodeHooks({ project_dir: tmp, command: 'new-flowlens' });
    expect(kept).toMatchObject({ hooks_added: 0, hooks_existing: 3 });
    expect(JSON.stringify(await read())).toContain('old-flowlens');

    const forced = await installClaudeCodeHooks({ project_dir: tmp, command: 'new-flowlens', force: true });
    expect(forced.hooks_replaced).toBe(3);
    const text = JSON.stringify(await read());
    expect(text).not.toContain('old-flowlens');
    expect(text.match(/flowlens-managed/g)).toHaveLength(3);
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
    const result = await installClaudeCodeHooks({ project_dir: tmp, command: 'flowlens' });
    expect(result).toMatchObject({ hooks_added: 0, hooks_replaced: 3 });
    const content = await read();
    const all = Object.values(content.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)
      .flatMap((groups) => groups.flatMap((g) => g.hooks.map((h) => h.command)));
    expect(all.filter((c) => c.includes('agent '))).toHaveLength(3);
    expect(all.every((c) => !c.includes('agent ') || c.endsWith('# flowlens-managed'))).toBe(true);
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
