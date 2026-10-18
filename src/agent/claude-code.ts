/**
 * Claude Code hook installer/uninstaller for `.claude/settings.json`.
 *
 * Ownership: every FlowLens hook command ends with the shell comment
 * `# flowlens-managed` (FLOWLENS_HOOK_MARKER). Hooks run in shell form
 * (`sh -c` / Git Bash / PowerShell), where a trailing `#` comment is ignored,
 * so the marker is invisible at runtime but lets uninstall/--force find our
 * entries regardless of the `--command` used. Legacy (pre-marker) entries are
 * recognised by their `agent context --hook --event …` / `agent guard --hook`
 * arguments and migrated on install.
 *
 * File safety lives in settings-file.ts (no overwrite of invalid JSON,
 * timestamped backup, atomic write).
 */
import type {
  AgentInstallResult,
  AgentUninstallResult,
  ClaudeCodeHookInstallOptions,
  ClaudeHookCommand,
  ClaudeSettings,
  HookGroup,
} from '../contracts/agent.js';
import { FLOWLENS_HOOK_MARKER } from '../contracts/agent.js';
import { defaultHookBaseCommand } from './hook-command.js';
import {
  backupClaudeSettings,
  claudeSettingsPath,
  loadClaudeSettings,
  writeClaudeSettingsAtomic,
} from './settings-file.js';

/** Root argument passed to every hook; Claude Code substitutes the placeholder. */
export const HOOK_ROOT_ARG = '--root "${CLAUDE_PROJECT_DIR}"';

/** Explicit per-hook timeouts in seconds (Claude Code defaults: 600, or 30 on UserPromptSubmit). */
export const HOOK_TIMEOUTS = { SessionStart: 30, UserPromptSubmit: 15, PostToolUse: 60 } as const;

const LEGACY_PATTERN = /\bagent (context --hook --event (session_start|prompt_submit)|guard --hook)\b/;

export function isFlowLensHook(hook: { command?: unknown }): boolean {
  if (typeof hook.command !== 'string') return false;
  return hook.command.includes(FLOWLENS_HOOK_MARKER) || LEGACY_PATTERN.test(hook.command);
}

function managed(command: string): string {
  return `${command} ${FLOWLENS_HOOK_MARKER}`;
}

export function buildClaudeCodeHookSettings(command = defaultHookBaseCommand()): ClaudeSettings {
  const hook = (args: string, timeout: number, statusMessage: string): ClaudeHookCommand => ({
    type: 'command',
    command: managed(`${command} ${args} ${HOOK_ROOT_ARG}`),
    timeout,
    statusMessage,
  });
  return {
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear|compact',
        hooks: [hook('agent context --hook --event session_start', HOOK_TIMEOUTS.SessionStart, 'FlowLens: loading codebase context')],
      }],
      UserPromptSubmit: [{
        hooks: [hook('agent context --hook --event prompt_submit', HOOK_TIMEOUTS.UserPromptSubmit, 'FlowLens: matching prompt to the code graph')],
      }],
      PostToolUse: [{
        matcher: 'Edit|MultiEdit|Write',
        hooks: [hook('agent guard --hook --reindex --strict', HOOK_TIMEOUTS.PostToolUse, 'FlowLens: checking the edit')],
      }],
    },
  };
}

export async function installClaudeCodeHooks(
  options: ClaudeCodeHookInstallOptions,
): Promise<AgentInstallResult> {
  const settingsPath = claudeSettingsPath(options.project_dir);
  const loaded = await loadClaudeSettings(settingsPath);
  const command = options.command ?? defaultHookBaseCommand();
  const planned = buildClaudeCodeHookSettings(command);
  const stats = mergeHooks(loaded.settings, planned, options.force ?? false);

  let backupPath: string | undefined;
  if (stats.changed) {
    backupPath = await backupClaudeSettings(settingsPath);
    await writeClaudeSettingsAtomic(settingsPath, loaded.settings);
  }
  return {
    provider: 'claude-code',
    settings_path: settingsPath,
    hooks_added: stats.added,
    hooks_existing: stats.existing,
    hooks_replaced: stats.replaced,
    backup_path: backupPath,
    command,
  };
}

export async function uninstallClaudeCodeHooks(projectDir: string): Promise<AgentUninstallResult> {
  const settingsPath = claudeSettingsPath(projectDir);
  const loaded = await loadClaudeSettings(settingsPath);
  if (!loaded.exists) {
    return { provider: 'claude-code', settings_path: settingsPath, hooks_removed: 0, settings_found: false };
  }
  const removed = removeFlowLensHooks(loaded.settings);
  let backupPath: string | undefined;
  if (removed > 0) {
    backupPath = await backupClaudeSettings(settingsPath);
    await writeClaudeSettingsAtomic(settingsPath, loaded.settings);
  }
  return {
    provider: 'claude-code',
    settings_path: settingsPath,
    hooks_removed: removed,
    backup_path: backupPath,
    settings_found: true,
  };
}

/** Remove every FlowLens-owned hook; drop groups/events only when we emptied them. */
export function removeFlowLensHooks(settings: ClaudeSettings): number {
  if (!settings.hooks) return 0;
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const count = removeOwnedFromEvent(settings.hooks, event);
    removed += count;
  }
  return removed;
}

function removeOwnedFromEvent(hooks: Record<string, HookGroup[]>, event: string, keep?: ClaudeHookCommand): number {
  const groups = hooks[event] ?? [];
  let removed = 0;
  const kept: HookGroup[] = [];
  for (const group of groups) {
    const before = group.hooks.length;
    const remaining = group.hooks.filter((hook) => hook === keep || !isFlowLensHook(hook));
    removed += before - remaining.length;
    if (remaining.length > 0 || before === 0) kept.push({ ...group, hooks: remaining });
  }
  if (removed === 0) return 0;
  if (kept.length > 0) hooks[event] = kept;
  else delete hooks[event];
  return removed;
}

function mergeHooks(
  target: ClaudeSettings,
  source: ClaudeSettings,
  force: boolean,
): { added: number; existing: number; replaced: number; changed: boolean } {
  target.hooks ??= {};
  const stats = { added: 0, existing: 0, replaced: 0, changed: false };

  for (const [event, groups] of Object.entries(source.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const owned = ownedHooks(target.hooks[event] ?? []);
        const marked = owned.filter((h) => h.command.includes(FLOWLENS_HOOK_MARKER));
        if (marked.length > 0 && !force) {
          stats.existing += 1;
          if (removeOwnedFromEvent(target.hooks, event, marked[0]) > 0) stats.changed = true;
          continue;
        }
        if (owned.length > 0) {
          removeOwnedFromEvent(target.hooks, event);
          stats.replaced += 1;
        } else {
          stats.added += 1;
        }
        target.hooks[event] ??= [];
        findOrCreateGroup(target.hooks[event], group.matcher).hooks.push(hook);
        stats.changed = true;
      }
    }
  }
  return stats;
}

function ownedHooks(groups: HookGroup[]): ClaudeHookCommand[] {
  return groups.flatMap((group) => group.hooks.filter(isFlowLensHook));
}

function findOrCreateGroup(groups: HookGroup[], matcher?: string): HookGroup {
  const existing = groups.find((group) => (group.matcher ?? '') === (matcher ?? ''));
  if (existing) return existing;
  const created: HookGroup = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
  groups.push(created);
  return created;
}
