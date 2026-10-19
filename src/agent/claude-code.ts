/**
 * Claude Code hook installer/uninstaller (Phase 7, revised in Phase 12
 * review M3).
 *
 * Where hooks go (verified against code.claude.com/docs/en/settings,
 * "Settings files and precedence"): Claude Code reads both
 * `.claude/settings.json` ("Shared project … commit it") and
 * `.claude/settings.local.json` ("Project local … You, in this one project
 * only"), applying the local file over the shared one. The default hook
 * command embeds this machine's absolute FlowLens path, so by default we
 * write the LOCAL file and make sure git ignores it (Claude Code only
 * auto-ignores it when it creates the file itself). `--shared` writes the
 * shared file, preferring the portable `npx --no-install flowlens` when
 * FlowLens is a local dependency, and warns when the command is still an
 * absolute path.
 *
 * Hooks from both files would run, so install moves FlowLens hooks out of
 * the other file: machine-specific ones always; portable shared ones are
 * left in place with a warning (a teammate may rely on them).
 *
 * The pure merge/remove logic lives in claude-hooks.ts; file safety
 * (invalid JSON is never overwritten, timestamped backup, atomic write) in
 * settings-file.ts.
 */
import type {
  AgentInstallResult,
  AgentUninstallResult,
  ClaudeCodeHookInstallOptions,
  ClaudeHookCommand,
  ClaudeSettingsScope,
} from '../contracts/agent.js';
import { buildClaudeCodeHookSettings, listFlowLensHooks, mergeHooks, removeFlowLensHooks } from './claude-hooks.js';
import { ensureLocalSettingsIgnored } from './git-exclude.js';
import { defaultHookBaseCommand, embedsAbsolutePath, portableHookBaseCommand } from './hook-command.js';
import {
  backupClaudeSettings,
  claudeLocalSettingsPath,
  claudeSettingsPath,
  claudeSettingsPathFor,
  loadClaudeSettings,
  writeClaudeSettingsAtomic,
} from './settings-file.js';

export {
  buildClaudeCodeHookSettings, describeHookRoles, HOOK_ROOT_ARG, HOOK_TIMEOUTS, isFlowLensHook, removeFlowLensHooks,
} from './claude-hooks.js';

/** Remove FlowLens hooks matching `filter` from one settings file (backup + atomic write). */
async function removeFrom(path: string, filter?: (h: ClaudeHookCommand) => boolean): Promise<{ removed: number; backup?: string; found: boolean }> {
  const loaded = await loadClaudeSettings(path);
  if (!loaded.exists) return { removed: 0, found: false };
  const removed = removeFlowLensHooks(loaded.settings, filter);
  if (removed === 0) return { removed: 0, found: true };
  const backup = await backupClaudeSettings(path);
  await writeClaudeSettingsAtomic(path, loaded.settings);
  return { removed, backup, found: true };
}

export async function installClaudeCodeHooks(
  options: ClaudeCodeHookInstallOptions,
): Promise<AgentInstallResult> {
  const scope: ClaudeSettingsScope = options.shared ? 'shared' : 'local';
  const settingsPath = claudeSettingsPathFor(options.project_dir, scope);
  const otherPath = scope === 'shared' ? claudeLocalSettingsPath(options.project_dir) : claudeSettingsPath(options.project_dir);
  const warnings: string[] = [];

  // Validate both files before writing either (invalid JSON → ClaudeSettingsError, nothing written).
  const loaded = await loadClaudeSettings(settingsPath);
  const other = await loadClaudeSettings(otherPath);

  const command = options.command
    ?? (scope === 'shared' ? portableHookBaseCommand(options.project_dir) : null)
    ?? defaultHookBaseCommand();
  if (scope === 'shared' && embedsAbsolutePath(command)) {
    warnings.push(`The hook command embeds an absolute path on this machine (${command}); teammates who use the committed .claude/settings.json need FlowLens at the same path. Add FlowLens as a devDependency (then hooks use "npx --no-install flowlens"), pass --command, or install without --shared.`);
  }

  const planned = buildClaudeCodeHookSettings(command, { gate: options.gate ?? true });
  const stats = mergeHooks(loaded.settings, planned, options.force ?? false);
  let backupPath: string | undefined;
  if (stats.changed) {
    backupPath = await backupClaudeSettings(settingsPath);
    await writeClaudeSettingsAtomic(settingsPath, loaded.settings);
  }

  // No duplicate hook runs: move FlowLens hooks out of the other file.
  let moved = 0;
  if (other.exists && listFlowLensHooks(other.settings).length > 0) {
    const machineSpecific = (h: ClaudeHookCommand) => scope === 'shared' || embedsAbsolutePath(h.command);
    const result = await removeFrom(otherPath, machineSpecific);
    moved = result.removed;
    const left = listFlowLensHooks((await loadClaudeSettings(otherPath)).settings).length;
    if (left > 0) {
      warnings.push(`${otherPath} also has ${left} portable FlowLens hook(s) (shared with the team); Claude Code runs hooks from both files. Remove them with "flowlens agent uninstall claude-code --shared" if they are not needed.`);
    }
  }

  let gitIgnoredVia: string | undefined;
  if (scope === 'local') {
    const ignored = ensureLocalSettingsIgnored(options.project_dir);
    if (ignored.kind === 'already' || ignored.kind === 'added') gitIgnoredVia = ignored.via;
    else if (ignored.kind === 'failed') warnings.push(`Could not add .claude/settings.local.json to git's excludes (${ignored.message}); add it to .gitignore yourself.`);
  }

  return {
    provider: 'claude-code',
    settings_path: settingsPath,
    hooks_added: stats.added,
    hooks_existing: stats.existing,
    hooks_replaced: stats.replaced,
    ...(stats.removed > 0 ? { hooks_removed: stats.removed } : {}),
    backup_path: backupPath,
    command,
    scope,
    ...(moved > 0 ? { hooks_moved: moved, moved_from: otherPath } : {}),
    ...(gitIgnoredVia ? { git_ignored_via: gitIgnoredVia } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Remove FlowLens hooks from both settings files (or only one with
 * `scope`). `settings_path` names the file hooks were removed from (the
 * local file when nothing was removed).
 */
export async function uninstallClaudeCodeHooks(projectDir: string, scope?: ClaudeSettingsScope): Promise<AgentUninstallResult> {
  const paths = scope ? [claudeSettingsPathFor(projectDir, scope)] : [claudeLocalSettingsPath(projectDir), claudeSettingsPath(projectDir)];
  // Validate every file first, so a malformed one leaves all of them untouched.
  for (const p of paths) await loadClaudeSettings(p);
  const files: NonNullable<AgentUninstallResult['files']> = [];
  let found = false;
  for (const path of paths) {
    const r = await removeFrom(path);
    found ||= r.found;
    if (r.found) files.push({ path, hooks_removed: r.removed, ...(r.backup ? { backup_path: r.backup } : {}) });
  }
  const changed = files.filter((f) => f.hooks_removed > 0);
  return {
    provider: 'claude-code',
    settings_path: changed[0]?.path ?? files[0]?.path ?? paths[0],
    hooks_removed: changed.reduce((n, f) => n + f.hooks_removed, 0),
    backup_path: changed[0]?.backup_path,
    settings_found: found,
    files,
  };
}
