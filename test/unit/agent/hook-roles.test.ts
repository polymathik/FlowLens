import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeSettings } from '../../../src/contracts/agent.js';
import {
  buildHookSettings, describeHookRoles, listFlowLensHooks, mergeHooks, removeFlowLensHooks, roleOf,
} from '../../../src/agent/claude-hooks.js';
import { codexHookStatus, codexHooksPath, installCodexHooks, uninstallCodexHooks } from '../../../src/agent/codex-hooks.js';

const events = (s: ClaudeSettings) => Object.keys(s.hooks ?? {}).sort();

describe('hook roles', () => {
  it('plans five hooks with the gate, four without', () => {
    expect(listFlowLensHooks(buildHookSettings('fl'))).toHaveLength(5);
    const noGate = buildHookSettings('fl', { gate: false });
    expect(listFlowLensHooks(noGate)).toHaveLength(4);
    expect(events(noGate)).not.toContain('PreToolUse');
    expect(JSON.stringify(noGate)).not.toContain('--gate');
  });

  it('a role-less marker and a legacy command mean the event primary role', () => {
    expect(roleOf({ command: 'fl agent guard --hook # flowlens-managed' }, 'PostToolUse')).toBe('guard');
    expect(roleOf({ command: 'fl agent context --hook --event prompt_submit' }, 'UserPromptSubmit')).toBe('context');
    expect(roleOf({ command: 'fl agent record --hook # flowlens-managed:record' }, 'PostToolUse')).toBe('record');
  });

  it('guard and record share PostToolUse without replacing each other', () => {
    const target: ClaudeSettings = {};
    const first = mergeHooks(target, buildHookSettings('fl'), false);
    expect(first).toMatchObject({ added: 5, existing: 0, replaced: 0, removed: 0 });
    const again = mergeHooks(target, buildHookSettings('fl'), false);
    expect(again).toMatchObject({ added: 0, existing: 5, replaced: 0, changed: false });
    expect(target.hooks!.PostToolUse).toHaveLength(2);
  });

  it('refreshes only the role whose command changed', () => {
    const target: ClaudeSettings = {};
    mergeHooks(target, buildHookSettings('fl'), false);
    const out = mergeHooks(target, buildHookSettings('fl2'), false);
    expect(out.replaced).toBe(5);
    expect(JSON.stringify(target)).not.toContain('"fl agent');
  });

  it('prunes the gate when it is no longer planned and keeps user hooks', () => {
    const target: ClaudeSettings = { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'audit' }] }] } };
    mergeHooks(target, buildHookSettings('fl'), false);
    expect(target.hooks!.PreToolUse).toHaveLength(2);
    const out = mergeHooks(target, buildHookSettings('fl', { gate: false }), false);
    expect(out.removed).toBe(1);
    expect(target.hooks!.PreToolUse).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: 'audit' }] }]);
    expect(JSON.stringify(target)).not.toContain('--gate"');
  });

  it('removeFlowLensHooks leaves foreign hooks and drops emptied events', () => {
    const target: ClaudeSettings = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say' }] }] } };
    mergeHooks(target, buildHookSettings('fl'), false);
    expect(removeFlowLensHooks(target)).toBe(5);
    expect(target.hooks).toEqual({ Stop: [{ hooks: [{ type: 'command', command: 'say' }] }] });
  });

  it('describeHookRoles reports installed, stale and missing roles', () => {
    const planned = buildHookSettings('fl');
    expect(describeHookRoles({}, planned)).toEqual({ installed: [], stale: [], missing: ['context', 'guard', 'record', 'gate'] });
    const target: ClaudeSettings = {};
    mergeHooks(target, planned, false);
    expect(describeHookRoles(target, planned).installed.sort()).toEqual(['context', 'gate', 'guard', 'record']);
    expect(describeHookRoles(target, buildHookSettings('moved'))).toMatchObject({ stale: expect.arrayContaining(['gate', 'guard']) });
    const partial: ClaudeSettings = JSON.parse(JSON.stringify(target));
    delete partial.hooks!.PreToolUse;
    expect(describeHookRoles(partial, planned)).toMatchObject({ missing: ['gate'] });
  });

  it('a Codex build adds --agent codex and omits --root', () => {
    const text = JSON.stringify(buildHookSettings('fl', { agent: 'codex', root: false }));
    expect(text).toContain('--agent codex');
    expect(text).not.toContain('--root');
  });
});

describe('codex hooks file', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await realpath(await mkdtemp(join(tmpdir(), 'flowlens-codex-'))); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('installs into .codex/hooks.json idempotently and keeps a personal install out of git', async () => {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    const first = await installCodexHooks({ project_dir: tmp, command: 'fl' });
    expect(first).toMatchObject({ provider: 'codex', hooks_added: 5, scope: 'local', settings_path: codexHooksPath(tmp) });
    execFileSync('git', ['check-ignore', '-q', '.codex/hooks.json'], { cwd: tmp });
    const text = await readFile(codexHooksPath(tmp), 'utf-8');
    expect(text).toContain('--agent codex');
    expect(text).not.toContain('CLAUDE_PROJECT_DIR');
    const second = await installCodexHooks({ project_dir: tmp, command: 'fl' });
    expect(second).toMatchObject({ hooks_added: 0, hooks_existing: 5 });
    expect(second.backup_path).toBeUndefined();
  });

  it('--no-gate leaves four hooks; status reports roles; uninstall deletes a file that was only ours', async () => {
    await installCodexHooks({ project_dir: tmp, command: 'fl', gate: false });
    const status = await codexHookStatus(tmp, 'fl', false);
    expect(status.installed.sort()).toEqual(['context', 'guard', 'record']);
    const out = await uninstallCodexHooks(tmp);
    expect(out.hooks_removed).toBe(4);
    expect(existsSync(codexHooksPath(tmp))).toBe(false);
  });
});
