/**
 * Flow contract (Map v2, M6a) — "what happens when X runs?" answered from the
 * static graph. Shared by the flow service (`src/flow/`), the MCP tools
 * `trace_flow` / `list_entry_points`, the REST routes
 * `GET /api/projects/:id/canvas/flow/{entry-points,trace}` and the CLI
 * `flowlens flow`. Types are inferred from the zod schemas so the runtime
 * checks (MCP conformance, REST query parsing) cannot drift from them.
 *
 * Canvas code should `import type` from here and take runtime constants
 * (kinds, limits, routes) from `./flow-constants.ts`, which has no zod.
 *
 * Reading a trace:
 *  - `hops` are in CALL ORDER (depth-first over the breadth-first tree,
 *    siblings sorted by reference line). `from` always calls/creates `to`,
 *    for both directions; `depth` is the distance of the hop's FAR end from
 *    the root (callee for `out`, caller for `in`).
 *  - Unresolved calls (`resolution: 'unresolved'`) have `to: ''` and a
 *    `target_name`; ambiguous ones carry `candidates` (entity ids).
 *  - Repeated call sites of the same callee are one hop with `count > 1`.
 */
import { z } from 'zod';
import {
  DEFAULT_FOLLOW, ENTRY_POINT_KINDS, FLOW_DIRECTIONS, FLOW_FOLLOW_TYPES, FLOW_LANE_KINDS,
  FLOW_LIMITS, FLOW_LINKS, FLOW_PROVENANCE, FLOW_RESOLUTIONS,
} from './flow-constants.js';
import type { FlowErrorCode } from './flow-constants.js';
import { EntityKindSchema, type EntityCandidate } from './mcp/schemas/common.js';

export * from './flow-constants.js';

const line = z.number().int().min(0);
const unit = z.number().min(0).max(1);

/** An inline handler's line range inside `entity_id` (callbacks have no entity of their own). */
export const HandlerSpanSchema = z.strictObject({ line_start: line, line_end: line });
export type HandlerSpan = z.infer<typeof HandlerSpanSchema>;

/**
 * Something that starts a flow. `file`/`line` is where the entry is DECLARED
 * (the route registration, the `bin` field, the page file); `entity_id` is
 * what to trace (the handler, or the enclosing function/file for an inline
 * callback, narrowed by `span`).
 */
export const EntryPointSchema = z.strictObject({
  entity_id: z.string(),
  qualified_name: z.string(),
  file: z.string(),
  line,
  kind: z.enum(ENTRY_POINT_KINDS),
  /** Human label: 'GET /api/sessions', 'cli: start', 'page /about', 'bin: halcyon'. */
  label: z.string(),
  confidence: unit,
  /** How it was detected: 'hono api.get() registration, handler getSessions resolved via import'. */
  evidence: z.string(),
  span: HandlerSpanSchema.optional(),
});
export type EntryPoint = z.infer<typeof EntryPointSchema>;

export const FlowHopSchema = z.strictObject({
  from: z.string(),
  /** Callee entity id; '' when `resolution` is 'unresolved' (or an ambiguous name with no single target). */
  to: z.string(),
  /** Graph relation id, or a synthetic `text:…` / `dispatch:…` id for non-graph hops. */
  relation_id: z.string(),
  type: z.enum(['call', 'create', 'use', 'throw', 'implement', 'override', 'extend']),
  depth: z.number().int().min(1),
  /** Where the call is written. */
  ref: z.strictObject({ file: z.string(), line }),
  resolution: z.enum(FLOW_RESOLUTIONS),
  confidence: unit,
  candidates: z.array(z.string()).optional(),
  /** Symbolic callee for unresolved/ambiguous hops ('Logger.warn'). */
  target_name: z.string().optional(),
  /** Call sites folded into this hop (relation weight). */
  count: z.number().int().min(1),
  link: z.enum(FLOW_LINKS),
  provenance: z.enum(FLOW_PROVENANCE),
});
export type FlowHop = z.infer<typeof FlowHopSchema>;

/** Entity summary for a node of the trace. */
export const FlowNodeSchema = z.strictObject({
  id: z.string(),
  kind: EntityKindSchema,
  name: z.string(),
  qualified_name: z.string(),
  file: z.string(),
  line,
  /** Shortest distance from the root (root = 0). */
  depth: z.number().int().min(0),
  /** Position in call order (root = 0). */
  order: z.number().int().min(0),
  lane_id: z.string(),
  /** Set when this node is itself an entry point (a trace that runs into another flow). */
  entry_kind: z.enum(ENTRY_POINT_KINDS).optional(),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

/** A swimlane: nodes grouped by package or folder. */
export const FlowLaneSchema = z.strictObject({
  /** Hierarchy node id: 'package:<dir>', 'folder:<dir>' or 'project'. */
  id: z.string(),
  label: z.string(),
  kind: z.enum(FLOW_LANE_KINDS),
  /** Directory of the lane ('' = project root). */
  path: z.string(),
  nodeIds: z.array(z.string()),
});
export type FlowLane = z.infer<typeof FlowLaneSchema>;

export const FlowStatsSchema = z.strictObject({
  depth_reached: z.number().int().min(0),
  nodes: z.number().int().min(0),
  hops: z.number().int().min(0),
  unresolved: z.number().int().min(0),
  ambiguous: z.number().int().min(0),
  /** Reachable nodes left out because of `max_nodes`. */
  dropped: z.number().int().min(0),
});
export type FlowStats = z.infer<typeof FlowStatsSchema>;

export const FlowTraceSchema = z.strictObject({
  root: EntryPointSchema,
  direction: z.enum(FLOW_DIRECTIONS),
  hops: z.array(FlowHopSchema),
  nodes: z.array(FlowNodeSchema),
  truncated: z.boolean(),
  /** `in` traces: the entry points the callers lead back to, nearest first. */
  triggers: z.array(EntryPointSchema),
  stats: FlowStatsSchema,
  lanes: z.array(FlowLaneSchema),
  /** Plain-language caveats for this trace (module-scope handler scanned from source, etc.). */
  notes: z.array(z.string()),
});
export type FlowTrace = z.infer<typeof FlowTraceSchema>;

/* ---------------- inputs ---------------- */

export const FLOW_DEPTH_DESCRIPTION = `Depth (default ${FLOW_LIMITS.depth.default}, max ${FLOW_LIMITS.depth.cap})`;

/** Shape shared by the MCP tool, the REST query and the CLI after parsing. */
export const FlowTraceInputShape = {
  entity: z.string().min(1).describe(
    "What to trace: an entry-point label ('GET /api/users', 'cli: start'), or an entity id, qualified name, file path or (unique) name",
  ),
  depth: z.number().int().min(1).optional().describe(FLOW_DEPTH_DESCRIPTION),
  direction: z.enum(FLOW_DIRECTIONS).optional().describe(
    "'out' (default): what runs when this runs. 'in': what triggers this — callers up to entry points",
  ),
  max_nodes: z.number().int().min(1).optional().describe(`Max nodes (default ${FLOW_LIMITS.mcpMaxNodes.default}, max ${FLOW_LIMITS.mcpMaxNodes.cap})`),
  follow: z.array(z.enum(FLOW_FOLLOW_TYPES)).optional().describe(`Relation types to follow (default ${DEFAULT_FOLLOW.join(', ')})`),
  include_tests: z.boolean().optional().describe('Also follow into test files (default false)'),
};

export const EntryPointsInputShape = {
  kind: z.array(z.enum(ENTRY_POINT_KINDS)).optional().describe('Only these kinds (default: everything except test and unknown)'),
  path: z.string().optional().describe('Only entries declared under this path prefix'),
  include_tests: z.boolean().optional().describe('Include test entry points (default false)'),
  max_results: z.number().int().min(1).optional().describe(`Max entries (default ${FLOW_LIMITS.mcpEntryPoints.default}, max ${FLOW_LIMITS.mcpEntryPoints.cap})`),
};

export type FlowTraceInput = z.input<z.ZodObject<typeof FlowTraceInputShape>>;
export type EntryPointsInput = z.input<z.ZodObject<typeof EntryPointsInputShape>>;

/* ---------------- outputs ---------------- */

export const EntryPointsResultSchema = z.strictObject({
  entry_points: z.array(EntryPointSchema),
  /** Counts per kind over ALL matches (not just the returned page). */
  counts_by_kind: z.record(z.string(), z.number().int()),
});
export type EntryPointsResult = z.infer<typeof EntryPointsResultSchema>;

/** MCP `data` of `trace_flow`: the structured trace plus a terminal-friendly tree. */
export const TraceFlowOutputSchema = z.strictObject({
  trace: FlowTraceSchema,
  text: z.string(),
});
export type TraceFlowOutput = z.infer<typeof TraceFlowOutputSchema>;

/** REST: `GET …/flow/entry-points` */
export interface FlowEntryPointsResponse extends EntryPointsResult {
  total: number;
  truncated: boolean;
}

export interface FlowErrorBody {
  ok: false;
  error: { code: FlowErrorCode; message: string };
  /** `ambiguous`: entities (or entry labels) the caller can retry with. */
  candidates?: EntityCandidate[];
  suggestions?: string[];
}
