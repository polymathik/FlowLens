/**
 * The FlowLens managed block in a Codex `config.toml`, and a tolerant line scanner for detection.
 *
 * No TOML parser is used: we only ever write one self-contained `[mcp_servers.flowlens]` table between two
 * marker comments, and everything outside the markers is preserved byte for byte. Detection of servers is a
 * line scan (table headers, `command`/`args`/`enabled` keys), which is enough to answer "is FlowLens there?".
 */
import { FLOWLENS_MCP_SERVER_NAME } from '../../contracts/agent-setup.js';
import { looksLikeFlowLens } from './serve-command.js';
import { McpConfigError, type ServeCommand } from './types.js';

export const BLOCK_START = '# >>> flowlens-managed >>>';
export const BLOCK_END = '# <<< flowlens-managed <<<';
/** Seconds Codex waits for the server to start (default 10; the first start may index the project). */
export const STARTUP_TIMEOUT_SEC = 30;

const toml = (s: string): string => JSON.stringify(s);

/** The block text without trailing newline. `cwd` pins the server to the project (local scope only). */
export function renderBlock(cmd: ServeCommand, cwd?: string, eol = '\n'): string {
  return [
    BLOCK_START,
    '# Managed by FlowLens (`flowlens agent install codex` / `uninstall codex`). Edits inside this block are overwritten.',
    `[mcp_servers.${FLOWLENS_MCP_SERVER_NAME}]`,
    `command = ${toml(cmd.command)}`,
    `args = [${cmd.args.map(toml).join(', ')}]`,
    ...(cwd ? [`cwd = ${toml(cwd)}`] : []),
    `startup_timeout_sec = ${STARTUP_TIMEOUT_SEC}`,
    BLOCK_END,
  ].join(eol);
}

interface BlockRange {
  /** Index of the first char of the start marker line. */
  start: number;
  /** Index just after the end marker (before its line break). */
  end: number;
}

export function findBlock(text: string, path = 'config.toml'): BlockRange | null {
  const startMatches = [...text.matchAll(new RegExp(`^${escapeRe(BLOCK_START)}[ \\t]*$`, 'gm'))];
  const endMatches = [...text.matchAll(new RegExp(`^${escapeRe(BLOCK_END)}[ \\t]*$`, 'gm'))];
  if (startMatches.length === 0 && endMatches.length === 0) return null;
  if (startMatches.length !== 1 || endMatches.length !== 1 || (endMatches[0].index as number) < (startMatches[0].index as number)) {
    throw new McpConfigError('unbalanced_block', path, `${path} has an incomplete or duplicated FlowLens managed block (${BLOCK_START} … ${BLOCK_END}). FlowLens will not edit it; fix the markers or remove the block by hand.`);
  }
  const start = startMatches[0].index as number;
  const end = (endMatches[0].index as number) + endMatches[0][0].replace(/[ \t]+$/, '').length;
  return { start, end };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\<>]/g, '\\$&');

export const detectEol = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n');

export interface BlockEdit {
  text: string;
  changed: boolean;
}

/** Insert or replace the managed block. Content outside the block is never altered. */
export function applyBlock(text: string, block: string, path?: string): BlockEdit {
  const range = findBlock(text, path);
  if (range) {
    const next = text.slice(0, range.start) + block + text.slice(range.end);
    return { text: next, changed: next !== text };
  }
  const eol = detectEol(text);
  const sep = text === '' ? '' : text.endsWith('\n') ? eol : `${eol}${eol}`;
  return { text: `${text}${sep}${block}${eol}`, changed: true };
}

/** Remove the managed block (and the blank line FlowLens added before it). */
export function removeBlock(text: string, path?: string): BlockEdit {
  const range = findBlock(text, path);
  if (!range) return { text, changed: false };
  let start = range.start;
  let end = range.end;
  if (text.startsWith('\r\n', end)) end += 2; else if (text.startsWith('\n', end)) end += 1;
  // Drop one blank separator line that applyBlock put before the block.
  const before = text.slice(0, start);
  const blank = /\r?\n\r?\n$/.exec(before);
  if (blank && start - blank[0].length >= 0 && before.length > blank[0].length) start -= detectEol(text).length;
  return { text: text.slice(0, start) + text.slice(end), changed: true };
}

export interface ScannedServer {
  name: string;
  /** Inside the managed block. */
  managed: boolean;
  disabled: boolean;
  /** Its `command`/`args` mention flowlens. */
  mentions_flowlens: boolean;
}

export interface ScanResult {
  /** Servers whose table is `flowlens` or whose command mentions flowlens. */
  servers: ScannedServer[];
  /** A `[mcp_servers.flowlens…]` table (or dotted key) outside the managed block. */
  foreign_flowlens_table: boolean;
}

const TABLE_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
const OTHER_TABLE_RE = /^\s*\[[^\]]*\]\s*(?:#.*)?$/;
const DOTTED_RE = /^\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*[.=]/;

/** Line scan: which MCP servers does this config define, and does a hand-written flowlens table exist? */
export function scanCodexToml(text: string): ScanResult {
  const servers = new Map<string, ScannedServer>();
  let current: string | null = null;
  let managed = false;
  let foreign = false;
  const touch = (name: string): ScannedServer => {
    const s = servers.get(name) ?? { name, managed, disabled: false, mentions_flowlens: false };
    servers.set(name, s);
    return s;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === BLOCK_START) { managed = true; continue; }
    if (line.trim() === BLOCK_END) { managed = false; continue; }
    const table = TABLE_RE.exec(line);
    if (table) {
      current = table[1] ?? table[2] ?? table[3];
      touch(current);
      if (current === FLOWLENS_MCP_SERVER_NAME && !managed) foreign = true;
      continue;
    }
    if (OTHER_TABLE_RE.test(line)) { current = null; continue; }
    const dotted = DOTTED_RE.exec(line);
    const name = dotted ? (dotted[1] ?? dotted[2] ?? dotted[3]) : current;
    if (!name) continue;
    if (dotted) { touch(name); if (name === FLOWLENS_MCP_SERVER_NAME && !managed) foreign = true; }
    const entry = touch(name);
    const key = dotted ? line.replace(DOTTED_RE, '') : line;
    if (/^\s*enabled\s*=\s*false\b/.test(key)) entry.disabled = true;
    if (/^\s*(command|args)\s*=/.test(key) && looksLikeFlowLens(key, [])) entry.mentions_flowlens = true;
  }
  const hit = [...servers.values()].filter((s) => s.name === FLOWLENS_MCP_SERVER_NAME || s.mentions_flowlens);
  return { servers: hit, foreign_flowlens_table: foreign };
}
