/**
 * Flow contract constants (Map v2, M6a) — plain values with no imports, so
 * the canvas bundle can use them without pulling in zod. The schemas and
 * types built on these live in `./flow.ts`.
 */

/** What starts a flow. `unknown` is "an arbitrary entity the user asked to trace". */
export const ENTRY_POINT_KINDS = [
  'http_route', 'cli_command', 'main', 'bin', 'page_route',
  'event_handler', 'ui_component_root', 'test', 'export_api', 'unknown',
] as const;
export type EntryPointKind = (typeof ENTRY_POINT_KINDS)[number];

/** Kinds shown in the entry-point list by default (tests and unknown are opt-in). */
export const DEFAULT_ENTRY_KINDS: readonly EntryPointKind[] = ENTRY_POINT_KINDS.filter((k) => k !== 'test' && k !== 'unknown');

/** Relation types a trace may follow. `call` and `create` (constructors, child components) by default. */
export const FLOW_FOLLOW_TYPES = ['call', 'create', 'use', 'throw'] as const;
export type FlowFollowType = (typeof FLOW_FOLLOW_TYPES)[number];
export const DEFAULT_FOLLOW: readonly FlowFollowType[] = ['call', 'create'];

export const FLOW_DIRECTIONS = ['out', 'in'] as const;
export type FlowDirection = (typeof FLOW_DIRECTIONS)[number];

export const FLOW_RESOLUTIONS = ['resolved', 'ambiguous', 'unresolved'] as const;
export type FlowResolution = (typeof FLOW_RESOLUTIONS)[number];

/**
 * Where a hop came from: `graph` = an indexed relation, `source_scan` = a
 * call found by scanning an inline handler's source (the extractor does not
 * attribute module-scope callbacks), `dispatch` = an interface/override
 * implementation reached through the graph's implement/extend/override edges.
 */
export const FLOW_PROVENANCE = ['graph', 'source_scan', 'dispatch'] as const;
export type FlowProvenance = (typeof FLOW_PROVENANCE)[number];

/** `new` = first time the callee is reached, `seen` = reached before via another path, `cycle` = back to an ancestor. */
export const FLOW_LINKS = ['new', 'seen', 'cycle'] as const;
export type FlowLink = (typeof FLOW_LINKS)[number];

export const FLOW_LANE_KINDS = ['package', 'folder', 'layer', 'zone'] as const;
export type FlowLaneKind = (typeof FLOW_LANE_KINDS)[number];

export const FLOW_LIMITS = {
  depth: { default: 4, cap: 5 },
  maxNodes: { default: 150, cap: 150 },
  /** MCP default: smaller, to protect the agent's context. */
  mcpMaxNodes: { default: 60, cap: 150 },
  entryPoints: { default: 200, cap: 1000 },
  mcpEntryPoints: { default: 40, cap: 200 },
  /** Lanes drawn at most (the grouping level is coarsened until it fits). */
  lanes: 8,
  /** Implementations followed through one interface/override dispatch point. */
  dispatchCandidates: 8,
} as const;

/** REST routes (served per project, same auth as the other `/canvas` routes). */
export const FLOW_ROUTES = {
  entryPoints: '/api/projects/:id/canvas/flow/entry-points',
  trace: '/api/projects/:id/canvas/flow/trace',
} as const;

export const FLOW_ERROR_CODES = ['bad_request', 'not_found', 'ambiguous'] as const;
export type FlowErrorCode = (typeof FLOW_ERROR_CODES)[number];

export const FLOW_ERROR_STATUS: Record<FlowErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  ambiguous: 409,
};

/** Explorer deep link fragment for the (future) Flow view: `#/p/<id>/map/flow/<entityId>?depth=N`. */
export const FLOW_LINK_KIND = 'flow';
