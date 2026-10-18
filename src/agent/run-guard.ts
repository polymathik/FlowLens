/**
 * `flowlens agent guard` orchestration (CLI-independent, returns output).
 *
 * 1. Resolve changed files (argument → filtered hook input → filtered git fallback).
 * 2. Read the digest cache BEFORE touching the graph (fast path, see guard-graph.ts).
 * 3. Open the graph via openAgentGraph (the FlowLens daemon by default, so this
 *    works while `serve --watch` runs) only when re-indexing or when no fresh
 *    digest exists. Busy/failed → explicit warning, never a silent pass.
 * 4. If no baseline exists for HEAD, capture it from a pre-edit source BEFORE
 *    re-indexing (baseline-capture.ts).
 * 5. Re-index through the same store (RemoteGraphStore writes via the daemon),
 *    stamp the revision, analyse once, attribute issues against the baseline.
 * 6. Persist the refreshed digest (with the re-indexed files "accounted") so
 *    the next hook stays on the fast path even after the watcher re-applies
 *    the same edit.
 */
import type {
  AgentBaseline,
  AgentCommandResult,
  AgentGraphUnavailable,
  AgentGuardReport,
  AgentOutputFormat,
  AgentRisk,
  ClaudeHookInput,
} from '../contracts/agent.js';
import type { GraphStore } from '../contracts/graph.js';
import { loadBaseline } from './baseline.js';
import { ensureGuardBaseline } from './baseline-capture.js';
import { getGitHead, resolveChangedFiles, type ResolvedChangedFiles } from './changed-files.js';
import { computeGraphDigest, computeGraphIssues, type AgentGraphDigest, type IssueScope } from './digest.js';
import { serviceRevision } from './service-revision.js';
import { captureStamp, readDigest, readFreshDigest, writeDigest, type GraphStamp } from './digest-cache.js';
import { accountFiles } from './digest-revalidate.js';
import { buildChangedFileFilter } from './file-filter.js';
import { formatGuardMarkdown } from './format.js';
import { buildAgentGuardReport, shouldBlock } from './guard.js';
import { changedFilesScope, graphFromDigest, patchChangedFiles } from './guard-graph.js';
import { describeGraphFailure, flowlensDirFor, openAgentGraph } from './graph-access.js';
import { computeHealthHeadline } from './health-headline.js';
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
  /** `false` = `--no-daemon`. */
  daemon?: boolean;
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
  const reindex = options.reindex && changed.files.length > 0;
  // When re-indexing, the changed files are re-read from the live graph and
  // patched in, so the digest may already be stale for exactly those files
  // (e.g. the daemon's watcher applied the edit first).
  const digest = await readFreshDigest(
    flowlensDir, reindex ? changed.files : [], await serviceRevision(flowlensDir, { daemon: options.daemon }),
  );
  if (digest && !reindex) {
    const baseline = await loadBaseline(flowlensDir, head);
    return render(options, await analyse(graphFromDigest(digest), flowlensDir, options, changed, baseline));
  }

  const handle = await openAgentGraph(rootDir, { daemon: options.daemon });
  if (!handle.ok) return unavailable(options, handle);
  let report: AgentGuardReport;
  let refreshed: AgentGraphDigest;
  let stamp: GraphStamp | null;
  try {
    const baseline = await ensureGuardBaseline({
      rootDir, flowlensDir, head, digest: digest ?? await readDigest(flowlensDir), graph: handle.graph, changedFiles: changed.files,
    }, reindex);
    const reindexSummary = reindex
      ? await reindexAgentChangedFiles(rootDir, handle.graph, changed.files)
      : undefined;
    // after our writes, before our reads
    stamp = captureStamp(flowlensDir, await serviceRevision(flowlensDir, { daemon: options.daemon }));
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
    refreshed.health = digest ? digest.health ?? null : await computeHealthHeadline(rootDir, handle.graph);
    refreshed.accounted = accountFiles(rootDir, digest?.accounted, changed.files, stamp?.read_at ?? Date.now());
  } catch (err) {
    return unavailable(options, describeGraphFailure(err, { daemon: options.daemon }));
  } finally {
    await handle.close().catch(() => undefined);
  }
  await writeDigest(flowlensDir, refreshed, stamp);
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

function unavailable(options: RunGuardOptions, failure: AgentGraphUnavailable): AgentCommandResult {
  const guardMessage = `${failure.message} The FlowLens guard did NOT check this edit.`;
  if (options.hook) {
    // Strict mode must never look like a clean pass: tell the user, not only the agent.
    const systemMessage = options.strict
      ? `FlowLens strict guard skipped: ${failure.reason === 'busy' ? 'the graph is locked by another process' : 'the graph could not be read'}.`
      : undefined;
    return ok(JSON.stringify(contextOutput('PostToolUse', guardMessage, { budget: options.budget, systemMessage })));
  }
  const exit_code = options.strict ? 1 : 0;
  if (options.format === 'json') {
    return { exit_code, stdout: JSON.stringify({ available: false, checked: false, reason: failure.reason, message: guardMessage }, null, 2), stderr: '' };
  }
  return { exit_code, stdout: '', stderr: guardMessage };
}

function ok(stdout: string): AgentCommandResult {
  return { exit_code: 0, stdout, stderr: '' };
}
