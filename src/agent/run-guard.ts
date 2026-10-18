/**
 * `flowlens agent guard` orchestration (CLI-independent, returns output).
 *
 * 1. Resolve changed files (argument → filtered hook input → filtered git fallback).
 * 2. Read the digest cache BEFORE opening the graph (fast path, see guard-graph.ts).
 * 3. Open the graph via openAgentGraph only when re-indexing or when no fresh
 *    digest exists (busy → explicit warning, never a silent pass).
 * 4. If no baseline exists for HEAD, capture it BEFORE re-indexing.
 * 5. Re-index, analyse once, attribute issues against the baseline.
 * 6. Persist the refreshed digest so the next hook stays on the fast path.
 */
import type {
  AgentBaseline,
  AgentCommandResult,
  AgentGuardReport,
  AgentOutputFormat,
  AgentRisk,
  ClaudeHookInput,
} from '../contracts/agent.js';
import type { GraphStore } from '../contracts/graph.js';
import { loadBaseline, makeBaseline, saveBaseline } from './baseline.js';
import { getGitHead, resolveChangedFiles, type ResolvedChangedFiles } from './changed-files.js';
import { computeGraphDigest, computeGraphIssues, type AgentGraphDigest, type IssueScope } from './digest.js';
import { readFreshDigest, writeDigest } from './digest-cache.js';
import { buildChangedFileFilter } from './file-filter.js';
import { formatGuardMarkdown } from './format.js';
import { buildAgentGuardReport, shouldBlock } from './guard.js';
import { changedFilesScope, graphFromDigest, patchChangedFiles } from './guard-graph.js';
import { flowlensDirFor, openAgentGraph } from './graph-access.js';
import { changedFilesFromHook } from './hook-input.js';
import { blockOutput, contextOutput } from './hook-output.js';
import { riskAtLeast } from './options.js';
import { reindexAgentChangedFiles } from './reindex.js';

export interface RunGuardOptions {
  rootDir: string;
  explicitFiles: string[];
  hookInput: ClaudeHookInput;
  hook: boolean;
  useGit: boolean;
  reindex: boolean;
  strict: boolean;
  maxItems: number;
  format: AgentOutputFormat;
  /** Hook mode: minimum risk that produces additionalContext output. */
  minRisk: AgentRisk;
  budget?: number;
}

export async function runAgentGuard(options: RunGuardOptions): Promise<AgentCommandResult> {
  const { rootDir } = options;
  const flowlensDir = flowlensDirFor(rootDir);
  const keep = await buildChangedFileFilter(rootDir);
  const hookFiles = changedFilesFromHook(options.hookInput, rootDir);
  const relevantHookFiles = hookFiles.filter(keep);
  // The hook named only non-source files (docs, .flowlens/*): nothing to guard, no git fallback.
  if (options.explicitFiles.length === 0 && hookFiles.length > 0 && relevantHookFiles.length === 0) return ok('');
  const changed = await resolveChangedFiles({
    explicit: options.explicitFiles,
    hook: relevantHookFiles,
    rootDir,
    useGit: options.useGit,
  });
  if (options.hook && changed.files.length === 0) return ok('');

  const head = getGitHead(rootDir);
  const digest = await readFreshDigest(flowlensDir);
  const reindex = options.reindex && changed.files.length > 0;
  if (digest && !reindex) {
    const baseline = await loadBaseline(flowlensDir, head);
    return render(options, await analyse(graphFromDigest(digest), flowlensDir, options, changed, baseline));
  }

  const handle = await openAgentGraph(rootDir);
  if (!handle.ok) return unavailable(options, handle.message, handle.reason === 'busy');
  let report: AgentGuardReport;
  let refreshed: AgentGraphDigest | undefined;
  try {
    const baseline = await ensureBaseline(flowlensDir, head, digest, handle.graph, reindex);
    const reindexSummary = reindex
      ? await reindexAgentChangedFiles(rootDir, handle.graph, changed.files)
      : undefined;
    let view: GraphStore = handle.graph;
    let scope: IssueScope = {};
    if (digest) {
      const memory = graphFromDigest(digest);
      await patchChangedFiles(memory, handle.graph, changed.files);
      scope = await changedFilesScope(memory, digest, changed.files);
      view = memory;
    }
    const issues = await computeGraphIssues(view, flowlensDir, scope);
    report = await analyse(view, flowlensDir, options, changed, baseline, reindexSummary, issues);
    refreshed = await computeGraphDigest(view, flowlensDir, issues);
  } finally {
    await handle.close();
  }
  if (refreshed) await writeDigest(flowlensDir, refreshed);
  return render(options, report);
}

async function analyse(
  graph: GraphStore,
  flowlensDir: string,
  options: RunGuardOptions,
  changed: ResolvedChangedFiles,
  baseline: AgentBaseline | null,
  reindex?: AgentGuardReport['reindex'],
  issues?: Awaited<ReturnType<typeof computeGraphIssues>>,
): Promise<AgentGuardReport> {
  return buildAgentGuardReport(graph, {
    changed_files: changed.files,
    changed_source: changed.source,
    strict: options.strict,
    max_items: options.maxItems,
    reindex,
    baseline: baseline ?? undefined,
  }, { flowlensDir, issues });
}

/** Baseline for HEAD; if missing and we are about to re-index, capture it first. */
async function ensureBaseline(
  flowlensDir: string,
  head: string | null,
  digest: AgentGraphDigest | null,
  graph: GraphStore,
  capture: boolean,
): Promise<AgentBaseline | null> {
  const existing = await loadBaseline(flowlensDir, head);
  if (existing || !capture) return existing;
  const keys = digest
    ? { cycles: digest.cycle_keys, violations: digest.violation_ids }
    : await computeGraphIssues(graph, flowlensDir).then((issues) => ({
      cycles: issues.cycles.map((cycle) => cycle.entities),
      violations: issues.violations.map((violation) => violation.id),
    }));
  const baseline = makeBaseline(head, 'guard', keys.cycles, keys.violations);
  try {
    await saveBaseline(flowlensDir, baseline);
  } catch {
    // still use it for this run
  }
  return baseline;
}

function render(options: RunGuardOptions, report: AgentGuardReport): AgentCommandResult {
  const markdown = formatGuardMarkdown(report);
  const block = options.strict && shouldBlock(report);
  if (options.hook) {
    if (block) {
      const reason = `FlowLens strict guard: this edit introduced ${report.cycles.length} new cycle(s) and ${report.architecture_violations.length} new architecture violation(s). Fix them or explain why they are acceptable before continuing.`;
      return ok(JSON.stringify(blockOutput(reason, markdown, options.budget)));
    }
    const noteworthy = riskAtLeast(report.risk, options.minRisk) || (report.warnings?.length ?? 0) > 0;
    return ok(noteworthy ? JSON.stringify(contextOutput('PostToolUse', markdown, { budget: options.budget })) : '');
  }
  const stdout = options.format === 'json' ? JSON.stringify(report, null, 2) : markdown;
  if (block) return { exit_code: 2, stdout: options.format === 'json' ? stdout : '', stderr: markdown };
  return ok(stdout);
}

function unavailable(options: RunGuardOptions, message: string, busy: boolean): AgentCommandResult {
  const guardMessage = `${message} The FlowLens guard did NOT check this edit.`;
  if (options.hook) {
    const systemMessage = options.strict && busy
      ? 'FlowLens strict guard skipped: the graph is locked by another FlowLens process.'
      : undefined;
    return ok(JSON.stringify(contextOutput('PostToolUse', guardMessage, { budget: options.budget, systemMessage })));
  }
  const exit_code = options.strict ? 1 : 0;
  if (options.format === 'json') {
    return { exit_code, stdout: JSON.stringify({ available: false, checked: false, message: guardMessage }, null, 2), stderr: '' };
  }
  return { exit_code, stdout: '', stderr: guardMessage };
}

function ok(stdout: string): AgentCommandResult {
  return { exit_code: 0, stdout, stderr: '' };
}
