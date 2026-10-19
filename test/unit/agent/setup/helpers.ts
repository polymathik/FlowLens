import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliDeps, CliRunResult } from '../../../../src/agent/setup/claude-cli.js';

export async function tempDir(prefix = 'fl-setup-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** A project dir and a home dir, both temp. */
export async function tempProject(): Promise<{ proj: string; home: string }> {
  const root = await tempDir();
  const proj = join(root, 'proj');
  const home = join(root, 'home');
  await mkdir(proj, { recursive: true });
  await mkdir(home, { recursive: true });
  return { proj, home };
}

export async function writeClaudeJson(home: string, proj: string, servers: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { [proj]: { mcpServers: servers, ...extra } } }));
}

export interface FakeCli extends CliDeps {
  calls: string[][];
}

/**
 * A scripted `claude`: records argv, emulates `mcp add|remove` against an in-memory entry, and answers
 * `mcp get`. `ok(add)` lets tests make `add` fail.
 */
export function fakeCli(opts: { present?: boolean; addExit?: number; getText?: string; existing?: { command: string; args: string[] } | null; onChange?: (entry: { command: string; args: string[] } | null) => void } = {}): FakeCli {
  let entry = opts.existing ?? null;
  const calls: string[][] = [];
  return {
    calls,
    which: (name) => (name === 'claude' && opts.present !== false ? '/fake/bin/claude' : null),
    run: async (_file, args): Promise<CliRunResult> => {
      calls.push(args);
      if (args[1] === 'add') {
        if (opts.addExit) return { code: opts.addExit, stdout: '', stderr: 'boom' };
        if (entry) return { code: 1, stdout: '', stderr: 'MCP server flowlens already exists in local config' };
        const dash = args.indexOf('--');
        entry = { command: args[dash + 1], args: args.slice(dash + 2) };
        opts.onChange?.(entry);
        return { code: 0, stdout: 'Added', stderr: '' };
      }
      if (args[1] === 'remove') {
        if (!entry) return { code: 1, stdout: '', stderr: 'No MCP server named "flowlens" in local scope' };
        entry = null;
        opts.onChange?.(null);
        return { code: 0, stdout: 'Removed', stderr: '' };
      }
      if (args[1] === 'get') {
        return { code: 0, stderr: '', stdout: opts.getText ?? (entry
          ? `flowlens:\n  Scope: Local config (private to you in this project)\n  Status: ✓ Connected\n  Type: stdio\n  Command: ${entry.command}\n  Args: ${entry.args.join(' ')}\n  Environment:\n` : 'No MCP server') };
      }
      return { code: 1, stdout: '', stderr: 'unexpected' };
    },
  };
}
