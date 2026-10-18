/**
 * Flow mode deep links: the query part of `#/p/<id>/map/flow/<entityId>?depth=4&span=112-123&dir=in&…`
 * (contract: `CanvasRouteFlow` in contracts/canvas/flow-view.ts) and the conversions between a parsed link
 * and the `FlowSpec` kept in the store. Pure; used by `router/hash-route.ts` and `router/useFlowUrl.ts`.
 *
 * Defaults are left out of the link (depth 4, direction out, follow call+create, 150 nodes, no tests) so a
 * link made from the backend's `canvas_url` (`?depth=N[&span=a-b]`) and one made here are the same thing.
 */
import type { CanvasRouteFlow, FlowSpan, FlowSpec } from '../../contracts/canvas/index.js';
import { FLOW_DEFAULT_DEPTH, FLOW_MAX_DEPTH } from '../../contracts/canvas/index.js';
import { DEFAULT_FOLLOW, FLOW_DIRECTIONS, FLOW_FOLLOW_TYPES, FLOW_LIMITS, type FlowDirection, type FlowFollowType } from '../../contracts/flow-constants.js';

const int = (raw: string | null): number | undefined => {
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
};

export function parseSpan(raw: string | null): FlowSpan | undefined {
  const m = /^(\d+)-(\d+)$/.exec(raw ?? '');
  if (!m) return undefined;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return from >= 0 && to >= from ? { from, to } : undefined;
}

/** Parse the query of a flow link; unknown or invalid values are ignored (the default applies). */
export function parseFlowQuery(id: string, query: URLSearchParams): CanvasRouteFlow {
  const flow: CanvasRouteFlow = { id };
  const depth = int(query.get('depth'));
  if (depth !== undefined && depth >= 1) flow.depth = Math.min(depth, FLOW_MAX_DEPTH);
  const span = parseSpan(query.get('span'));
  if (span) flow.span = span;
  const dir = query.get('dir');
  if (dir && (FLOW_DIRECTIONS as readonly string[]).includes(dir)) flow.dir = dir as FlowDirection;
  const follow = (query.get('follow') ?? '').split(',').filter((t): t is FlowFollowType => (FLOW_FOLLOW_TYPES as readonly string[]).includes(t));
  if (follow.length > 0) flow.follow = follow;
  const max = int(query.get('max'));
  if (max !== undefined && max >= 1) flow.max = Math.min(max, FLOW_LIMITS.maxNodes.cap);
  if (query.get('tests') === '1') flow.tests = true;
  return flow;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** `key=value` parts of a flow link, defaults omitted. Order is fixed so links are stable. */
export function flowQueryParts(f: CanvasRouteFlow): string[] {
  const out: string[] = [];
  if (f.depth !== undefined) out.push(`depth=${f.depth}`);
  if (f.span) out.push(`span=${f.span.from}-${f.span.to}`);
  if (f.dir && f.dir !== 'out') out.push(`dir=${f.dir}`);
  if (f.follow?.length && !sameSet(f.follow, DEFAULT_FOLLOW)) out.push(`follow=${f.follow.join(',')}`);
  if (f.max !== undefined && f.max !== FLOW_LIMITS.maxNodes.default) out.push(`max=${f.max}`);
  if (f.tests) out.push('tests=1');
  return out;
}

/** Everything that changes the trace, as one string (route identity for "apply this link once"). */
export const flowRouteKey = (f: CanvasRouteFlow): string => `${f.id}?${flowQueryParts(f).join('&')}`;

export const flowSpecOfRoute = (f: CanvasRouteFlow): FlowSpec => ({
  id: f.id,
  depth: f.depth ?? FLOW_DEFAULT_DEPTH,
  direction: f.dir ?? 'out',
  ...(f.span ? { span: f.span } : {}),
  ...(f.follow?.length ? { follow: f.follow } : {}),
  ...(f.max !== undefined ? { maxNodes: f.max } : {}),
  ...(f.tests ? { includeTests: true } : {}),
});

/** The link of a spec. The depth is always written (the backend's links carry it too). */
export const routeFlowOfSpec = (s: FlowSpec): CanvasRouteFlow => ({
  id: s.id,
  depth: s.depth,
  ...(s.span ? { span: s.span } : {}),
  ...(s.direction !== 'out' ? { dir: s.direction } : {}),
  ...(s.follow?.length ? { follow: s.follow } : {}),
  ...(s.maxNodes !== undefined ? { max: s.maxNodes } : {}),
  ...(s.includeTests ? { tests: true } : {}),
});

/** True when two specs describe the same trace (the label is cosmetic). */
export function sameFlowSpec(a: FlowSpec | null, b: FlowSpec | null): boolean {
  if (!a || !b) return a === b;
  return flowRouteKey(routeFlowOfSpec(a)) === flowRouteKey(routeFlowOfSpec(b));
}
