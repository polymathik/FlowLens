/**
 * `flowlens agent context` orchestration (CLI-independent, returns output).
 *
 * Digest resolution order: fresh (or revalidated) cache, no graph access →
 * open the graph (through the daemon by default) and compute, then persist →
 * if the graph is busy (only possible with --no-daemon or a non-daemon lock
 * holder), stale cache with a warning → explicit "unavailable" context.
 * SessionStart also records the strict-mode baseline for the current git HEAD
 * if none exists yet, and carries a 3-line health headline.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentGraphOptions,
  AgentCommandResult,
  AgentContextPacket,
  AgentEvent,
  AgentOutputFormat,
  ClaudeHookEventName,
} from '../contracts/agent.js';
import { loadBaseline, makeBaseline, saveBaseline } from './baseline.js';
import { getGitHead } from './changed-files.js';
import { buildContextFromDigest } from './context-builder.js';
import { computeGraphDigest, type AgentGraphDigest } from './digest.js';
import { captureStamp, readDigest, readFreshDigest, writeDigest } from './digest-cache.js';
import { formatContextMarkdown } from './format.js';
import { describeGraphFailure, flowlensDirFor, openAgentGraph, SETUP_HINT } from './graph-access.js';
import { computeHealthHeadline } from './health-headline.js';
import { contextOutput, hookEventNameFor } from './hook-output.js';

export interface RunContextOptions {
  rootDir: string;
  event: AgentEvent;
  prompt?: string;
  changedFiles: string[];
  maxItems: number;
  format: AgentOutputFormat;
  hook: boolean;
  hookEventName?: string;
  budget?: number;
  /** `false` = `--no-daemon`. */
  daemon?: boolean;
}

export type DigestResolution =
  | { ok: true; digest: AgentGraphDigest; source: 'cache' | 'fresh' | 'stale-cache' }
  | { ok: false; message: string };

/** Shared by context, baseline and MCP-free fast paths: cache → graph → stale cache. */
export async function resolveDigest(rootDir: string, graphOptions: AgentGraphOptions = {}): Promise<DigestResolution> {
  const flowlensDir = flowlensDirFor(rootDir);
  if (!existsSync(join(flowlensDir, 'graph'))) return { ok: false, message: SETUP_HINT };
  const cached = await readFreshDigest(flowlensDir);
  if (cached) return { ok: true, digest: cached, source: 'cache' };

  const handle = await openAgentGraph(rootDir, graphOptions);
  if (!handle.ok) return staleOr(flowlensDir, handle.reason === 'busy', handle.message);
  let digest: AgentGraphDigest;
  try {
    const stamp = captureStamp(flowlensDir);
    digest = await computeGraphDigest(handle.graph, flowlensDir);
    digest.health = await computeHealthHeadline(rootDir, handle.graph);
    await writeDigest(flowlensDir, digest, stamp);
  } catch (err) {
    const failure = describeGraphFailure(err, graphOptions);
    return staleOr(flowlensDir, failure.reason === 'busy', failure.message);
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { ok: true, digest, source: 'fresh' };
}

async function staleOr(flowlensDir: string, busy: boolean, message: string): Promise<DigestResolution> {
  const stale = busy ? await readDigest(flowlensDir) : null;
  return stale ? { ok: true, digest: stale, source: 'stale-cache' } : { ok: false, message };
}

export async function runAgentContext(options: RunContextOptions): Promise<AgentCommandResult> {
  const eventName = hookEventNameFor(options.event, options.hookEventName);
  const resolution = await resolveDigest(options.rootDir, { daemon: options.daemon });
  if (!resolution.ok) return unavailable(options, eventName, resolution.message);

  if (options.event === 'session_start') {
    await ensureBaseline(options.rootDir, resolution.digest);
  }
  const packet = buildContextFromDigest(resolution.digest, {
    event: options.event,
    prompt: options.prompt,
    changed_files: options.changedFiles,
    max_items: options.maxItems,
  }, resolution.source);
  return render(options, eventName, packet);
}

async function ensureBaseline(rootDir: string, digest: AgentGraphDigest): Promise<void> {
  const flowlensDir = flowlensDirFor(rootDir);
  const head = getGitHead(rootDir);
  try {
    if (await loadBaseline(flowlensDir, head)) return;
    await saveBaseline(flowlensDir, makeBaseline(head, 'session_start', digest.cycle_keys, digest.violation_ids));
  } catch {
    // Baseline is best-effort; strict mode falls back to the guard's own capture.
  }
}

function render(
  options: RunContextOptions,
  eventName: ClaudeHookEventName,
  packet: AgentContextPacket,
): AgentCommandResult {
  if (options.hook) {
    const output = contextOutput(eventName, formatContextMarkdown(packet), { budget: options.budget });
    return { exit_code: 0, stdout: JSON.stringify(output), stderr: '' };
  }
  const stdout = options.format === 'json' ? JSON.stringify(packet, null, 2) : formatContextMarkdown(packet);
  return { exit_code: 0, stdout, stderr: '' };
}

function unavailable(
  options: RunContextOptions,
  eventName: ClaudeHookEventName,
  message: string,
): AgentCommandResult {
  if (options.hook) {
    return { exit_code: 0, stdout: JSON.stringify(contextOutput(eventName, message, { budget: options.budget })), stderr: '' };
  }
  if (options.format === 'json') {
    return { exit_code: 0, stdout: JSON.stringify({ available: false, message }, null, 2), stderr: '' };
  }
  return { exit_code: 0, stdout: message, stderr: '' };
}
