/**
 * The two flow questions, shared by the MCP tools, the REST routes and the
 * CLI: list entry points, trace a flow. Input defaults and limits live here
 * so every surface answers the same way.
 */
import {
  DEFAULT_FOLLOW, FLOW_LIMITS,
  type EntryPoint, type EntryPointsInput, type EntryPointsResult, type FlowErrorBody, type FlowTrace, type FlowTraceInput,
} from '../contracts/flow.js';
import type { FlowContext } from './context.js';
import { countByKind, filterEntryPoints } from './entry-points.js';
import { resolveTraceTarget } from './resolve-target.js';
import { traceFlow } from './trace.js';

export interface EntryPointsPage {
  result: EntryPointsResult;
  total: number;
  limit: number;
}

export function queryEntryPoints(ctx: FlowContext, input: EntryPointsInput, limits: { default: number; cap: number } = FLOW_LIMITS.entryPoints): EntryPointsPage {
  const all = filterEntryPoints(ctx.entries(), { kinds: input.kind, path: input.path, includeTests: input.include_tests });
  const requested = input.max_results;
  const limit = Math.max(1, Math.min(requested === undefined ? limits.default : Math.floor(requested), limits.cap));
  return { result: { entry_points: all.slice(0, limit), counts_by_kind: countByKind(all) }, total: all.length, limit };
}

export type TraceQueryResult = { ok: true; trace: FlowTrace } | { ok: false; error: FlowErrorBody };

export function queryTrace(ctx: FlowContext, input: FlowTraceInput, limits: { default: number; cap: number } = FLOW_LIMITS.maxNodes): TraceQueryResult {
  const target = resolveTraceTarget(ctx.graph, ctx.entries(), input.entity);
  if (!target.ok) {
    return {
      ok: false,
      error: {
        ok: false, error: { code: target.code, message: target.message },
        ...(target.candidates.length > 0 ? { candidates: target.candidates } : {}), suggestions: target.suggestions,
      },
    };
  }
  const maxNodes = Math.max(1, Math.min(input.max_nodes === undefined ? limits.default : Math.floor(input.max_nodes), limits.cap));
  const trace = traceFlow(ctx.graph, target.entry, {
    depth: input.depth, direction: input.direction, maxNodes, follow: input.follow ?? DEFAULT_FOLLOW, includeTests: input.include_tests,
    source: ctx.source, entries: ctx.entries(), packages: ctx.packages, projectName: ctx.projectName,
  });
  return { ok: true, trace };
}

export type { EntryPoint };
