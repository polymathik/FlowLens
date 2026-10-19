/**
 * Thin, injectable wrapper around the `claude` CLI (`claude mcp add|get|remove`).
 *
 * Verified against Claude Code 2.1.303: `add` exits 1 when the name already exists in that scope; `remove`
 * exits 1 when it does not; `get` health-checks the server (it starts it) and exits 0 even when the connection
 * fails, so connection state is parsed from its text, not its exit code.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { FLOWLENS_MCP_SERVER_NAME } from '../../contracts/agent-setup.js';
import { errorMessage, type ServeCommand } from './types.js';

export interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CliDeps {
  /** Absolute path of an executable on PATH, or null. */
  which(name: string): string | null;
  run(file: string, args: string[], options: { cwd: string; timeoutMs: number }): Promise<CliRunResult>;
}

export function whichSync(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`);
      try {
        if (statSync(candidate).isFile()) {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch { /* not here */ }
    }
  }
  return null;
}

export const realCliDeps: CliDeps = {
  which: (name) => whichSync(name),
  run: (file, args, { cwd, timeoutMs }) => new Promise((resolve) => {
    execFile(file, args, { cwd, timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null;
      resolve({ code, stdout: stdout ?? '', stderr: code === null ? `${stderr ?? ''}${errorMessage(err)}` : (stderr ?? '') });
    });
  }),
};

const ADD_TIMEOUT = 30_000;
const GET_TIMEOUT = 45_000;

export function claudeAddArgs(cmd: ServeCommand): string[] {
  return ['mcp', 'add', '--transport', 'stdio', '--scope', 'local', FLOWLENS_MCP_SERVER_NAME, '--', cmd.command, ...cmd.args];
}

export function claudeRemoveArgs(): string[] {
  return ['mcp', 'remove', FLOWLENS_MCP_SERVER_NAME, '--scope', 'local'];
}

export async function cliAdd(claude: string, cwd: string, cmd: ServeCommand, deps: CliDeps): Promise<CliRunResult> {
  return deps.run(claude, claudeAddArgs(cmd), { cwd, timeoutMs: ADD_TIMEOUT });
}

export async function cliRemove(claude: string, cwd: string, deps: CliDeps): Promise<CliRunResult> {
  return deps.run(claude, claudeRemoveArgs(), { cwd, timeoutMs: ADD_TIMEOUT });
}

export interface CliGetResult {
  found: boolean;
  scope?: string;
  status?: string;
  command?: string;
  args?: string;
  connected: boolean;
  raw: string;
}

/** Parse `claude mcp get <name>` output (`Scope:`, `Status:`, `Command:`, `Args:` lines). */
export function parseCliGet(output: string): CliGetResult {
  const field = (label: string): string | undefined => new RegExp(`^\\s*${label}:\\s*(.*)$`, 'm').exec(output)?.[1]?.trim();
  const status = field('Status');
  return {
    found: field('Command') !== undefined,
    scope: field('Scope'),
    status,
    command: field('Command'),
    args: field('Args'),
    connected: status !== undefined && /connected/i.test(status) && !/fail|×|✗/i.test(status),
    raw: output,
  };
}

export async function cliGet(claude: string, cwd: string, deps: CliDeps): Promise<CliGetResult | null> {
  const res = await deps.run(claude, ['mcp', 'get', FLOWLENS_MCP_SERVER_NAME], { cwd, timeoutMs: GET_TIMEOUT });
  if (res.code !== 0) return null;
  return parseCliGet(res.stdout);
}
