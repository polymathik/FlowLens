/**
 * The command that starts the FlowLens MCP server, with the same base-command logic as the hooks
 * (hook-command.ts): `node "<abs dist/cli/index.js>"` by default, the portable `npx --no-install flowlens`
 * for shared config when FlowLens is a project dependency, or an explicit `--command` override.
 */
import { defaultHookBaseCommand, embedsAbsolutePath, portableHookBaseCommand } from '../hook-command.js';
import type { ServeCommand } from './types.js';

/** Split a command line into argv (single/double quotes, backslash escapes inside double quotes). */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

function quoteIfNeeded(part: string): string {
  return /[\s"'\\$`]/.test(part) ? `"${part.replace(/(["\\$`])/g, '\\$1')}"` : part;
}

export interface ServeCommandOptions {
  shared: boolean;
  /** `--command` override: base command; `serve` is appended. */
  command?: string;
  platform?: NodeJS.Platform;
}

export function resolveServeCommand(projectDir: string, options: ServeCommandOptions): ServeCommand {
  const base = options.command
    ?? (options.shared ? portableHookBaseCommand(projectDir) : null)
    ?? defaultHookBaseCommand();
  const argv = [...splitCommandLine(base), 'serve'];
  const warnings: string[] = [];
  const machineSpecific = embedsAbsolutePath(base);
  if (options.shared && machineSpecific) {
    warnings.push(`The MCP command embeds an absolute path on this machine (${base}); teammates who use the committed config need FlowLens at the same path. Add FlowLens as a devDependency (then the config uses "npx --no-install flowlens serve"), pass --command, or connect without --shared.`);
  }
  if ((options.platform ?? process.platform) === 'win32' && argv[0] === 'npx') {
    warnings.push('On native Windows, Claude Code may need "cmd /c npx ..." to launch npx; pass --command "cmd /c npx --no-install flowlens" if the server does not start.');
  }
  return { command: argv[0], args: argv.slice(1), display: argv.map(quoteIfNeeded).join(' '), machine_specific: machineSpecific, warnings };
}

/**
 * True when an MCP entry (command + args) starts FlowLens: a token mentions flowlens, or it runs a
 * `.../dist/cli/index.js serve` entry point (a checkout whose folder is not called flowlens).
 */
export function looksLikeFlowLens(command: unknown, args: unknown): boolean {
  const tokens = [command, ...(Array.isArray(args) ? args : [])].filter((t): t is string => typeof t === 'string');
  return tokens.some((t) => /flowlens/i.test(t))
    || (tokens.includes('serve') && tokens.some((t) => /dist[\\/]cli[\\/]index\.js$/.test(t)));
}

/**
 * An entry registered under our own name (`flowlens`) that runs `… serve`: ours even when the command is a
 * custom one (`--command`, a checkout under another folder name) that does not mention flowlens.
 */
export function isOurServerEntry(command: unknown, args: unknown): boolean {
  const list = Array.isArray(args) ? args : [];
  return looksLikeFlowLens(command, args) || (typeof command === 'string' && list[list.length - 1] === 'serve');
}
