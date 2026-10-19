/**
 * Register / remove the FlowLens MCP server for Codex, in the project's `.codex/config.toml` (both scopes).
 *
 * A single managed block (`# >>> flowlens-managed >>>` … `# <<< flowlens-managed <<<`) holds
 * `[mcp_servers.flowlens]`; nothing outside it is rewritten. Codex has no personal/shared split, so scope
 * `local` writes the same file but keeps it out of git (when we created it and git does not track it), with
 * an absolute command path; scope `shared` leaves it for the team to commit and prefers the portable
 * `npx --no-install flowlens serve`. User-level `~/.codex/config.toml` is deliberately not written: where a
 * user-level server starts (its working directory) is not something we can verify.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FLOWLENS_MCP_SERVER_NAME, type AgentSetupScope, type McpInstallResult } from '../../contracts/agent-setup.js';
import { ensurePathIgnored } from '../git-exclude.js';
import { applyBlock, detectEol, removeBlock, renderBlock, scanCodexToml } from './codex-block.js';
import { backupFile, readTextIfExists, writeTextAtomic } from './file-safety.js';
import { resolveServeCommand } from './serve-command.js';
import type { McpUninstallOptions, McpUninstallResult } from './types.js';

export const codexConfigPath = (projectDir: string): string => join(projectDir, '.codex', 'config.toml');

export interface CodexMcpOptions {
  projectDir: string;
  scope: AgentSetupScope;
  command?: string;
}

export async function installCodexMcp(options: CodexMcpOptions): Promise<McpInstallResult> {
  const { projectDir, scope } = options;
  const path = codexConfigPath(projectDir);
  const cmd = resolveServeCommand(projectDir, { shared: scope === 'shared', command: options.command });
  const existing = await readTextIfExists(path);
  const text = existing ?? '';
  const warnings = [...cmd.warnings];
  const result: McpInstallResult = { provider: 'codex', method: 'codex-config', scope, path, changed: false, command: cmd.display };

  if (scanCodexToml(text).foreign_flowlens_table) {
    warnings.push(`${path} already defines [mcp_servers.${FLOWLENS_MCP_SERVER_NAME}] by hand; FlowLens left it untouched and added nothing. Remove that table (or use it as is) and re-run to let FlowLens manage it.`);
    return { ...result, warnings };
  }
  const block = renderBlock(cmd, scope === 'local' ? resolve(projectDir) : undefined, detectEol(text));
  const edit = applyBlock(text, block, path);
  if (edit.changed) {
    const backup = await backupFile(path);
    await writeTextAtomic(path, edit.text);
    result.changed = true;
    if (backup) result.backup_path = backup;
    if (existing === null && scope === 'local') {
      const ignored = ensurePathIgnored(projectDir, '.codex/config.toml', 'personal Codex MCP config (machine-specific path)');
      if (ignored.kind === 'failed') warnings.push(`Could not add .codex/config.toml to git's excludes (${ignored.message}); add it to .gitignore yourself.`);
    }
  }
  if (scope === 'local' && result.changed) warnings.push('The command in .codex/config.toml contains an absolute path on this machine, so it is for you only.');
  return { ...result, ...(warnings.length > 0 ? { warnings } : {}) };
}

export async function uninstallCodexMcp(projectDir: string, _options: McpUninstallOptions = {}): Promise<McpUninstallResult> {
  const result: McpUninstallResult = { provider: 'codex', removed: [], backup_paths: [], warnings: [] };
  const path = codexConfigPath(projectDir);
  const text = await readTextIfExists(path);
  if (text === null) return result;
  const edit = removeBlock(text, path);
  if (!edit.changed) {
    if (scanCodexToml(text).foreign_flowlens_table) result.warnings.push(`${path} has a [mcp_servers.${FLOWLENS_MCP_SERVER_NAME}] table that FlowLens did not write; left untouched.`);
    return result;
  }
  if (edit.text.trim() === '' && existsSync(path)) {
    await rm(path, { force: true }); // a file FlowLens created: nothing of the user's to back up
    result.removed.push('.codex/config.toml (deleted, it only held FlowLens)');
  } else {
    const backup = await backupFile(path);
    if (backup) result.backup_paths.push(backup);
    await writeTextAtomic(path, edit.text);
    result.removed.push('.codex/config.toml managed block');
  }
  return result;
}
