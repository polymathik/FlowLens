/**
 * Reader for Claude Code transcripts (`~/.claude/projects/<dir>/<session>.jsonl`).
 *
 * Verified shape (Claude Code 2.1.x): one JSON object per line. An assistant API response is written as
 * SEVERAL lines (one per content block: thinking, text, each tool_use) that share `message.id` and repeat
 * the same `message.usage`; summing usage per line would multiply the tokens, so usage is counted once per
 * message id (the largest value seen per field, in case a streaming line carries a partial figure). Each
 * `tool_use` block has its own `id` and appears on exactly one line. Human prompts are `type: "user"` lines
 * with text content; tool results, compaction summaries, meta lines and agent/task messages are also
 * `type: "user"` and must not be counted as prompts. Torn or foreign lines are skipped.
 *
 * Subagent transcripts (`<session>/subagents/*.jsonl`) are separate files and are not read here.
 */
import { readFile, stat } from 'node:fs/promises';
import type { AgentSessionStats } from '../../contracts/agent-setup.js';

export type TranscriptStats = NonNullable<AgentSessionStats['transcript']>;

/** What the transcript knows beyond the contract fields (history mode uses these). */
export interface ClaudeTranscriptSummary {
  /** Distinct assistant API responses ("steps"); the contract's `turns`. */
  turns: number;
  /** Human prompts typed by the user. */
  prompts: number;
  tool_calls: Record<string, number>;
  search_calls: number;
  flowlens_calls: number;
  flowlens_by_tool: Record<string, number>;
  tokens: TranscriptStats['tokens'];
  first_ts: string | null;
  last_ts: string | null;
}

/** File-discovery tools of Claude Code. Other agents' equivalents are not counted (see stats docs). */
export const CLAUDE_SEARCH_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob']);
const FLOWLENS_PREFIX = 'mcp__flowlens__';
/** Transcripts above this size are skipped (reported as unreadable) instead of loaded into memory. */
export const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;

interface Block { type?: string; id?: string; name?: string; text?: string }
interface Line {
  type?: string;
  timestamp?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  origin?: { kind?: string };
  message?: { id?: string; role?: string; content?: unknown; usage?: Record<string, unknown> };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function isHumanPrompt(line: Line): boolean {
  if (line.type !== 'user' || line.isMeta || line.isCompactSummary) return false;
  if (line.origin && line.origin.kind !== 'human') return false;
  const content = line.message?.content;
  if (typeof content === 'string') return content.trim() !== '';
  if (!Array.isArray(content)) return false;
  return (content as Block[]).some((b) => b?.type === 'text' && (b.text ?? '').trim() !== '');
}

export function parseClaudeTranscript(text: string): ClaudeTranscriptSummary {
  const usageById = new Map<string, TranscriptStats['tokens']>();
  const seenToolUse = new Set<string>();
  const toolCalls: Record<string, number> = {};
  let prompts = 0;
  let anonymousSteps = 0;
  let first: string | null = null;
  let last: string | null = null;

  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue; // torn last line or foreign data
    }
    if (!line || typeof line !== 'object') continue;
    if (typeof line.timestamp === 'string') {
      if (first === null || line.timestamp < first) first = line.timestamp;
      if (last === null || line.timestamp > last) last = line.timestamp;
    }
    if (isHumanPrompt(line)) prompts++;
    if (line.type !== 'assistant' || !line.message || line.message.role !== 'assistant') continue;

    const message = line.message;
    const key = typeof message.id === 'string' && message.id ? message.id : `anon:${anonymousSteps++}`;
    const usage = message.usage ?? {};
    const prev = usageById.get(key) ?? { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    usageById.set(key, {
      input: Math.max(prev.input, num(usage.input_tokens)),
      output: Math.max(prev.output, num(usage.output_tokens)),
      cache_read: Math.max(prev.cache_read, num(usage.cache_read_input_tokens)),
      cache_write: Math.max(prev.cache_write, num(usage.cache_creation_input_tokens)),
    });

    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as Block[]) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      if (block.id) {
        if (seenToolUse.has(block.id)) continue;
        seenToolUse.add(block.id);
      }
      toolCalls[block.name] = (toolCalls[block.name] ?? 0) + 1;
    }
  }

  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const u of usageById.values()) {
    tokens.input += u.input;
    tokens.output += u.output;
    tokens.cache_read += u.cache_read;
    tokens.cache_write += u.cache_write;
  }
  const flowlensByTool: Record<string, number> = {};
  let searchCalls = 0;
  let flowlensCalls = 0;
  for (const [name, count] of Object.entries(toolCalls)) {
    if (CLAUDE_SEARCH_TOOLS.has(name)) searchCalls += count;
    if (name.startsWith(FLOWLENS_PREFIX)) {
      flowlensByTool[name.slice(FLOWLENS_PREFIX.length)] = count;
      flowlensCalls += count;
    }
  }
  return {
    turns: usageById.size,
    prompts,
    tool_calls: toolCalls,
    search_calls: searchCalls,
    flowlens_calls: flowlensCalls,
    flowlens_by_tool: flowlensByTool,
    tokens,
    first_ts: first,
    last_ts: last,
  };
}

/** Parse a transcript file; null when missing, unreadable or too large. Never throws. */
export async function readClaudeTranscript(path: string): Promise<ClaudeTranscriptSummary | null> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size > MAX_TRANSCRIPT_BYTES) return null;
    return parseClaudeTranscript(await readFile(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** The contract's `transcript` block for a parsed summary. */
export function toTranscriptStats(path: string, summary: ClaudeTranscriptSummary): TranscriptStats {
  return {
    path,
    turns: summary.turns,
    tool_calls: summary.tool_calls,
    search_calls: summary.search_calls,
    tokens: summary.tokens,
  };
}
