import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AgentInstallResult,
  AgentUninstallResult,
  ClaudeCodeHookInstallOptions,
} from '../contracts/agent.js';

type HookCommand = {
  type: 'command';
  command: string;
  timeout?: number;
};

type HookGroup = {
  matcher?: string;
  hooks: HookCommand[];
};

type ClaudeSettings = {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
};

export async function installClaudeCodeHooks(
  options: ClaudeCodeHookInstallOptions,
): Promise<AgentInstallResult> {
  const settingsDir = join(options.project_dir, '.claude');
  const settingsPath = join(settingsDir, 'settings.json');
  await mkdir(settingsDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  const planned = buildClaudeCodeHookSettings(options.command ?? 'flowlens');
  const stats = mergeHooks(settings, planned, options.force ?? false);

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  return {
    provider: 'claude-code',
    settings_path: settingsPath,
    hooks_added: stats.added,
    hooks_existing: stats.existing,
  };
}

export async function uninstallClaudeCodeHooks(
  projectDir: string,
): Promise<AgentUninstallResult> {
  const settingsDir = join(projectDir, '.claude');
  const settingsPath = join(settingsDir, 'settings.json');
  await mkdir(settingsDir, { recursive: true });
  const settings = await readSettings(settingsPath);
  const removed = removeFlowLensHooks(settings);
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return {
    provider: 'claude-code',
    settings_path: settingsPath,
    hooks_removed: removed,
  };
}

export function buildClaudeCodeHookSettings(command = 'flowlens'): ClaudeSettings {
  return {
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume',
        hooks: [{
          type: 'command',
          command: `${command} agent context --hook --event session_start`,
          timeout: 10,
        }],
      }],
      UserPromptSubmit: [{
        hooks: [{
          type: 'command',
          command: `${command} agent context --hook --event prompt_submit`,
          timeout: 10,
        }],
      }],
      PostToolUse: [{
        matcher: 'Edit|MultiEdit|Write',
        hooks: [{
          type: 'command',
          command: `${command} agent guard --hook --reindex --strict`,
          timeout: 20,
        }],
      }],
    },
  };
}

function removeFlowLensHooks(settings: ClaudeSettings): number {
  let removed = 0;
  if (!settings.hooks) return removed;
  for (const [event, groups] of Object.entries(settings.hooks)) {
    const keptGroups: HookGroup[] = [];
    for (const group of groups) {
      const keptHooks = group.hooks.filter((hook) => {
        const remove = /\bflowlens agent (context|guard)\b/.test(hook.command);
        if (remove) removed += 1;
        return !remove;
      });
      if (keptHooks.length > 0) keptGroups.push({ ...group, hooks: keptHooks });
    }
    if (keptGroups.length > 0) settings.hooks[event] = keptGroups;
    else delete settings.hooks[event];
  }
  return removed;
}

function mergeHooks(
  target: ClaudeSettings,
  source: ClaudeSettings,
  force: boolean,
): { added: number; existing: number } {
  target.hooks ??= {};
  let added = 0;
  let existing = 0;

  for (const [event, groups] of Object.entries(source.hooks ?? {})) {
    target.hooks[event] ??= [];
    for (const group of groups) {
      const destination = findOrCreateGroup(target.hooks[event], group.matcher);
      for (const hook of group.hooks) {
        const index = destination.hooks.findIndex((item) => item.command === hook.command);
        if (index >= 0) {
          existing += 1;
          if (force) destination.hooks[index] = hook;
        } else {
          destination.hooks.push(hook);
          added += 1;
        }
      }
    }
  }

  return { added, existing };
}

function findOrCreateGroup(groups: HookGroup[], matcher?: string): HookGroup {
  const existing = groups.find((group) => (group.matcher ?? '') === (matcher ?? ''));
  if (existing) return existing;
  const created: HookGroup = matcher === undefined ? { hooks: [] } : { matcher, hooks: [] };
  groups.push(created);
  return created;
}

async function readSettings(path: string): Promise<ClaudeSettings> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as ClaudeSettings;
  } catch {
    return {};
  }
}
