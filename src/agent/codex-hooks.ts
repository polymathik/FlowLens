/**
 * Codex hook installer (Phase 23). Codex reads hooks from `<repo>/.codex/hooks.json` (project layer, only for
 * trusted projects) in the same JSON shape as Claude Code's settings, so the role-aware merge, backup and
 * atomic-write code is shared. Differences: Codex has no personal-vs-shared settings pair (a personal install
 * writes the same file and keeps it out of git), no project-dir variable (hooks start in the session cwd,
 * and FlowLens finds the project from the hook input), and edits arrive as `apply_patch`.
 * Codex records trust per hook definition: the user reviews new hooks once with `/hooks`.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentInstallResult, AgentUninstallResult, ClaudeCodeHookInstallOptions } from '../contracts/agent.js';
import type { FlowLensHookRole } from '../contracts/agent-setup.js';
import { buildHookSettings, describeHookRoles, listFlowLensHooks, mergeHooks, removeFlowLensHooks } from './claude-hooks.js';
import { ensurePathIgnored } from './git-exclude.js';
import { defaultHookBaseCommand, embedsAbsolutePath, portableHookBaseCommand } from './hook-command.js';
import { backupClaudeSettings, loadClaudeSettings, writeClaudeSettingsAtomic } from './settings-file.js';

export const CODEX_HOOKS_REL = '.codex/hooks.json';

export const codexHooksPath = (projectDir: string): string => join(projectDir, CODEX_HOOKS_REL);

export type CodexHookInstallOptions = Pick<ClaudeCodeHookInstallOptions, 'project_dir' | 'command' | 'force' | 'shared' | 'gate'>;

export async function installCodexHooks(options: CodexHookInstallOptions): Promise<AgentInstallResult> {
  const path = codexHooksPath(options.project_dir);
  const shared = Boolean(options.shared);
  const warnings: string[] = [];
  const loaded = await loadClaudeSettings(path);
  const command = options.command
    ?? (shared ? portableHookBaseCommand(options.project_dir) : null)
    ?? defaultHookBaseCommand();
  if (shared && embedsAbsolutePath(command)) {
    warnings.push(`The hook command embeds an absolute path on this machine (${command}); teammates who use the committed ${CODEX_HOOKS_REL} need FlowLens at the same path. Add FlowLens as a devDependency (then hooks use "npx --no-install flowlens"), pass --command, or install without --shared.`);
  }
  const planned = buildHookSettings(command, { gate: options.gate ?? true, root: false, agent: 'codex' });
  const stats = mergeHooks(loaded.settings, planned, options.force ?? false);
  let backupPath: string | undefined;
  if (stats.changed) {
    backupPath = await backupClaudeSettings(path);
    await writeClaudeSettingsAtomic(path, loaded.settings);
  }
  let gitIgnoredVia: string | undefined;
  if (!shared) {
    const ignored = ensurePathIgnored(options.project_dir, CODEX_HOOKS_REL, 'personal Codex hooks');
    if (ignored.kind === 'already' || ignored.kind === 'added') gitIgnoredVia = ignored.via;
    else if (ignored.kind === 'failed') warnings.push(`Could not add ${CODEX_HOOKS_REL} to git's excludes (${ignored.message}); add it to .gitignore yourself.`);
  }
  return {
    provider: 'codex',
    settings_path: path,
    hooks_added: stats.added,
    hooks_existing: stats.existing,
    hooks_replaced: stats.replaced,
    ...(stats.removed > 0 ? { hooks_removed: stats.removed } : {}),
    backup_path: backupPath,
    command,
    scope: shared ? 'shared' : 'local',
    ...(gitIgnoredVia ? { git_ignored_via: gitIgnoredVia } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function uninstallCodexHooks(projectDir: string): Promise<AgentUninstallResult> {
  const path = codexHooksPath(projectDir);
  const loaded = await loadClaudeSettings(path);
  if (!loaded.exists) return { provider: 'codex', settings_path: path, hooks_removed: 0, settings_found: false, files: [] };
  const removed = removeFlowLensHooks(loaded.settings);
  let backup: string | undefined;
  if (removed > 0) {
    backup = await backupClaudeSettings(path);
    const rest = Object.keys(loaded.settings).filter((k) => k !== 'hooks' && k !== 'description');
    const empty = Object.keys(loaded.settings.hooks ?? {}).length === 0;
    if (empty && rest.length === 0) await rm(path, { force: true }); // a file FlowLens created: leave nothing behind
    else await writeClaudeSettingsAtomic(path, loaded.settings);
  }
  return {
    provider: 'codex',
    settings_path: path,
    hooks_removed: removed,
    ...(backup ? { backup_path: backup } : {}),
    settings_found: true,
    files: [{ path, hooks_removed: removed, ...(backup ? { backup_path: backup } : {}) }],
  };
}

export interface CodexHookStatus {
  path: string;
  exists: boolean;
  installed: FlowLensHookRole[];
  stale: FlowLensHookRole[];
  missing: FlowLensHookRole[];
}

/** What is installed in `.codex/hooks.json` against what `installCodexHooks` would write now. */
export async function codexHookStatus(projectDir: string, command: string, gate: boolean): Promise<CodexHookStatus> {
  const path = codexHooksPath(projectDir);
  const loaded = await loadClaudeSettings(path);
  const planned = buildHookSettings(command, { gate, root: false, agent: 'codex' });
  const roles = describeHookRoles(loaded.settings, planned);
  return { path, exists: existsSync(path) && listFlowLensHooks(loaded.settings).length > 0, ...roles };
}
