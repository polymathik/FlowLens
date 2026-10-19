/**
 * Pure hook-settings logic for Claude Code and Codex (both read the same JSON shape): build FlowLens's
 * hook entries, recognise them, merge them into a settings object, describe what is installed, remove them.
 *
 * Ownership: every FlowLens hook command ends with the shell comment `# flowlens-managed:<role>`
 * (FLOWLENS_HOOK_MARKER + role). Hooks run in shell form (`sh -c` / Git Bash / PowerShell), where a trailing
 * `#` comment is ignored, so the marker is invisible at runtime but lets uninstall/--force find our entries
 * regardless of the `--command` used. A hook is identified by (event, role): two FlowLens hooks on one event
 * (guard + record on PostToolUse) never replace each other (Phase 23). A marker without a role, or a legacy
 * (pre-marker) `agent context --hook …` command, is the event's primary role (HOOK_PRIMARY_ROLE).
 * A marked hook whose command, timeout or status message differs from the planned one is refreshed, and
 * FlowLens hooks that are no longer planned (the gate after `--no-gate`) are removed.
 */
import type { ClaudeHookCommand, ClaudeSettings, HookGroup } from '../contracts/agent.js';
import { FLOWLENS_HOOK_MARKER } from '../contracts/agent.js';
import {
  FLOWLENS_TOOL_MATCHER, GATED_EDIT_MATCHER, HOOK_PRIMARY_ROLE, type FlowLensHookRole,
} from '../contracts/agent-setup.js';
import { defaultHookBaseCommand } from './hook-command.js';

/** Root argument passed to every Claude Code hook; Claude Code substitutes the placeholder. */
export const HOOK_ROOT_ARG = '--root "${CLAUDE_PROJECT_DIR}"';

/** Explicit per-hook timeouts in seconds (Claude Code defaults: 600, or 30 on UserPromptSubmit). */
export const HOOK_TIMEOUTS = { SessionStart: 30, UserPromptSubmit: 15, PreToolUse: 10, PostToolUse: 60, Record: 10 } as const;

const LEGACY_PATTERN = /\bagent (context --hook --event (session_start|prompt_submit)|guard --hook)\b/;
const ROLE_PATTERN = /# flowlens-managed:(context|guard|gate|record)\b/;

export interface HookBuildOptions {
  /** Install the PreToolUse edit gate (and tell the context hook that it is active). Default true. */
  gate?: boolean;
  /** Pass `--root "${CLAUDE_PROJECT_DIR}"` (Claude Code only; Codex hooks start in the session cwd). Default true. */
  root?: boolean;
  /** Value of `--agent` on every hook (default `claude-code`). */
  agent?: 'claude-code' | 'codex';
}

/** FlowLens hooks currently in `settings`. */
export function listFlowLensHooks(settings: ClaudeSettings): ClaudeHookCommand[] {
  return Object.values(settings.hooks ?? {}).flatMap((groups) => ownedHooks(groups));
}

export function isFlowLensHook(hook: { command?: unknown }): boolean {
  if (typeof hook.command !== 'string') return false;
  return hook.command.includes(FLOWLENS_HOOK_MARKER) || LEGACY_PATTERN.test(hook.command);
}

/** Role of a FlowLens hook on `event` (role-less and legacy hooks have the event's primary role). */
export function roleOf(hook: { command?: unknown }, event: string): FlowLensHookRole {
  const command = typeof hook.command === 'string' ? hook.command : '';
  const match = ROLE_PATTERN.exec(command);
  return (match?.[1] as FlowLensHookRole | undefined) ?? HOOK_PRIMARY_ROLE[event] ?? 'context';
}

function managed(command: string, role: FlowLensHookRole): string {
  return `${command} ${FLOWLENS_HOOK_MARKER}:${role}`;
}

export function buildHookSettings(command = defaultHookBaseCommand(), options: HookBuildOptions = {}): ClaudeSettings {
  const gate = options.gate ?? true;
  const agent = options.agent ?? 'claude-code';
  const tail = `${options.root === false ? '' : ` ${HOOK_ROOT_ARG}`}${agent === 'claude-code' ? '' : ` --agent ${agent}`}`;
  const hook = (role: FlowLensHookRole, args: string, timeout: number, statusMessage: string): ClaudeHookCommand => ({
    type: 'command',
    command: managed(`${command} ${args}${tail}`, role),
    timeout,
    statusMessage,
  });
  const gateFlag = gate ? ' --gate' : '';
  const settings: ClaudeSettings = {
    hooks: {
      SessionStart: [{
        matcher: 'startup|resume|clear|compact',
        hooks: [hook('context', `agent context --hook --event session_start${gateFlag}`, HOOK_TIMEOUTS.SessionStart, 'FlowLens: loading codebase context')],
      }],
      UserPromptSubmit: [{
        hooks: [hook('context', `agent context --hook --event prompt_submit${gateFlag}`, HOOK_TIMEOUTS.UserPromptSubmit, 'FlowLens: matching prompt to the code graph')],
      }],
      PostToolUse: [
        { matcher: 'Edit|MultiEdit|Write|apply_patch', hooks: [hook('guard', 'agent guard --hook --reindex --strict', HOOK_TIMEOUTS.PostToolUse, 'FlowLens: checking the edit')] },
        { matcher: FLOWLENS_TOOL_MATCHER, hooks: [hook('record', 'agent record --hook', HOOK_TIMEOUTS.Record, 'FlowLens: noting the query')] },
      ],
    },
  };
  if (gate) {
    settings.hooks!.PreToolUse = [{
      matcher: GATED_EDIT_MATCHER,
      hooks: [hook('gate', 'agent gate --hook', HOOK_TIMEOUTS.PreToolUse, 'FlowLens: checking the file was looked up')],
    }];
  }
  return settings;
}

/** Claude Code settings (the original entry point; Phase 23 added `options`). */
export function buildClaudeCodeHookSettings(command = defaultHookBaseCommand(), options: HookBuildOptions = {}): ClaudeSettings {
  return buildHookSettings(command, options);
}

/** Remove every FlowLens-owned hook; drop groups/events only when we emptied them. */
export function removeFlowLensHooks(settings: ClaudeSettings, filter: (h: ClaudeHookCommand) => boolean = () => true): number {
  if (!settings.hooks) return 0;
  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    removed += removeOwnedFromEvent(settings.hooks, event, { filter });
  }
  return removed;
}

interface RemoveOptions {
  /** Keep this very hook object. */
  keep?: ClaudeHookCommand;
  /** Only hooks with this role. */
  role?: FlowLensHookRole;
  filter?: (h: ClaudeHookCommand) => boolean;
}

function removeOwnedFromEvent(hooks: Record<string, HookGroup[]>, event: string, opts: RemoveOptions = {}): number {
  const groups = hooks[event] ?? [];
  let removed = 0;
  const kept: HookGroup[] = [];
  for (const group of groups) {
    const before = group.hooks.length;
    const remaining = group.hooks.filter((hook) => hook === opts.keep || !isFlowLensHook(hook)
      || (opts.role !== undefined && roleOf(hook, event) !== opts.role) || !(opts.filter ?? (() => true))(hook));
    removed += before - remaining.length;
    if (remaining.length > 0 || before === 0) kept.push({ ...group, hooks: remaining });
  }
  if (removed === 0) return 0;
  if (kept.length > 0) hooks[event] = kept;
  else delete hooks[event];
  return removed;
}

export function mergeHooks(
  target: ClaudeSettings,
  source: ClaudeSettings,
  force: boolean,
): { added: number; existing: number; replaced: number; removed: number; changed: boolean } {
  target.hooks ??= {};
  const stats = { added: 0, existing: 0, replaced: 0, removed: 0, changed: false };

  for (const [event, groups] of Object.entries(source.hooks ?? {})) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const role = roleOf(hook, event);
        const owned = ownedHooks(target.hooks[event] ?? []).filter((h) => roleOf(h, event) === role);
        // Up to date (same command, timeout, status message) → keep it; a changed base command
        // (moved install, new --command, gate on/off) is refreshed without --force.
        const current = owned.find((h) => h.command.includes(FLOWLENS_HOOK_MARKER) && sameHook(h, hook));
        if (current && !force) {
          stats.existing += 1;
          if (removeOwnedFromEvent(target.hooks, event, { keep: current, role }) > 0) stats.changed = true;
          continue;
        }
        if (owned.length > 0) {
          removeOwnedFromEvent(target.hooks, event, { role });
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
  // FlowLens hooks that are no longer planned (e.g. the gate after --no-gate).
  const planned = new Set(Object.entries(source.hooks ?? {}).flatMap(([event, gs]) => gs.flatMap((g) => g.hooks.map((h) => `${event}:${roleOf(h, event)}`))));
  for (const event of Object.keys(target.hooks)) {
    const stale = ownedHooks(target.hooks[event]).filter((h) => !planned.has(`${event}:${roleOf(h, event)}`));
    for (const hook of stale) {
      stats.removed += removeOwnedFromEvent(target.hooks, event, { role: roleOf(hook, event) });
      stats.changed = true;
    }
  }
  return stats;
}

/**
 * Per role: `installed` when every planned hook of the role is present and up to date, `missing` when none
 * is present, `stale` otherwise (present but a different command, or only some events).
 */
export function describeHookRoles(
  settings: ClaudeSettings, planned: ClaudeSettings,
): { installed: FlowLensHookRole[]; stale: FlowLensHookRole[]; missing: FlowLensHookRole[] } {
  const states = new Map<FlowLensHookRole, Array<'ok' | 'stale' | 'missing'>>();
  for (const [event, groups] of Object.entries(planned.hooks ?? {})) {
    for (const hook of groups.flatMap((g) => g.hooks)) {
      const role = roleOf(hook, event);
      const have = ownedHooks(settings.hooks?.[event] ?? []).filter((h) => roleOf(h, event) === role);
      const state = have.length === 0 ? 'missing' : have.some((h) => sameHook(h, hook)) ? 'ok' : 'stale';
      states.set(role, [...(states.get(role) ?? []), state]);
    }
  }
  const out = { installed: [] as FlowLensHookRole[], stale: [] as FlowLensHookRole[], missing: [] as FlowLensHookRole[] };
  for (const [role, list] of states) {
    if (list.every((s) => s === 'ok')) out.installed.push(role);
    else if (list.every((s) => s === 'missing')) out.missing.push(role);
    else out.stale.push(role);
  }
  return out;
}

function sameHook(a: ClaudeHookCommand, b: ClaudeHookCommand): boolean {
  return a.command === b.command && a.timeout === b.timeout && a.statusMessage === b.statusMessage;
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
