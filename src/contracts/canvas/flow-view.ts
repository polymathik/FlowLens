/**
 * Flow mode contract (Map v2, lane M6b) — the canvas side of "what happens when this runs?".
 *
 * The data comes from `GET …/canvas/flow/trace` (`FlowTrace`, `contracts/flow.ts`); this file holds what
 * the canvas adds: the request the user made (`FlowSpec`, kept in the store and written to the URL), the
 * view model built from a trace (cards, edges, lanes, steps, notices — pure, `src/canvas/flow/model`) and
 * the data carried by the React Flow nodes and edges.
 *
 *   #/p/<project>/map/flow/<entityId>?depth=4[&span=112-123][&dir=in][&follow=call,create,use][&max=60][&tests=1]
 *
 * `<entityId>` is what the trace route calls `entity`: an entity id (what the MCP `canvas_url` carries), an
 * entry-point label, a qualified name or a file path. With `span` it names one inline handler of that entity;
 * the view resolves the pair to the entry-point label before it asks for the trace.
 *
 * Reading the picture: columns = distance from the root (callers on the left for `dir=in`), rows = swimlanes
 * (package → folder, `FlowTrace.lanes`), cards inside a lane in call order, edges labelled with the call site.
 */
import type {
  EntryPointKind, FlowDirection, FlowFollowType, FlowLaneKind, FlowLink, FlowProvenance, FlowResolution,
} from '../flow-constants.js';

/** First and last line of an inline handler inside the root entity. */
export interface FlowSpan {
  from: number;
  to: number;
}

/** What the user asked for; stored per project tab and written to the URL. */
export interface FlowSpec {
  /** Root: entity id, entry label, qualified name or file path (the trace route's `entity`). */
  id: string;
  span?: FlowSpan;
  /** 1..FLOW_LIMITS.depth.cap */
  depth: number;
  /** `out`: what runs when this runs. `in`: what triggers this (callers up to entry points). */
  direction: FlowDirection;
  /** Relation types followed; absent = the default (call, create). */
  follow?: FlowFollowType[];
  /** Node limit; absent = FLOW_LIMITS.maxNodes.default. */
  maxNodes?: number;
  includeTests?: boolean;
  /** Entry label when known (picker): sent as the trace's `entity` (the only way to address an inline handler). Not in the URL. */
  label?: string;
  /** The root as the trace reported it, filled in once the trace has loaded: title for the breadcrumb, entity for its ancestors. Cosmetic: never sent, never in the URL. */
  resolved?: { title: string; entityId: string };
}

/** Parsed `flow/<id>?…` link. Absent fields mean "the default". */
export interface CanvasRouteFlow {
  id: string;
  depth?: number;
  span?: FlowSpan;
  dir?: FlowDirection;
  follow?: FlowFollowType[];
  max?: number;
  tests?: boolean;
}

/** Entry-point picker state in the store: open (optionally limited to a directory) or closed. */
export interface FlowPickerState {
  /** Only entry points declared under this path prefix ("Trace from here" on a folder or zone). */
  path?: string;
}

export const FLOW_DEFAULT_DEPTH = 4;
export const FLOW_MAX_DEPTH = 5;
export const FLOW_MAX_NODES_CHOICES = [25, 50, 100, 150] as const;

/* ---------------- view model (pure; built from a FlowTrace) ---------------- */

/** root = what is traced; step = a function reached; trigger = an entry point an `in` trace leads back to; leaf = a call the graph could not resolve. */
export type FlowCardRole = 'root' | 'step' | 'trigger' | 'unresolved' | 'candidates';

/** Another possible target of an ambiguous call (interface / override dispatch). */
export interface FlowCandidate {
  id: string;
  name: string;
  /** `file:line` when known. */
  where: string;
  /** True when the trace expanded it (it is a card in the picture). */
  inTrace: boolean;
}

export interface FlowCard {
  /** Entity id; `leaf:<hop index>` for an unresolved call. */
  id: string;
  /** Entity id, or null for a leaf. */
  entityId: string | null;
  /** Entity kind (function, method, class, file…); '' for a leaf. */
  kind: string;
  /** Display name: `Class.method()`, `fn()`, the file for module scope, `?? name` for a leaf. */
  name: string;
  file: string;
  line: number;
  role: FlowCardRole;
  /** Shortest distance from the root. */
  depth: number;
  /** Layout column: the depth for `out`, mirrored for `in` (root on the right). */
  column: number;
  /** Position in call order (root = 0). */
  seq: number;
  /** Step number of the hop that first reached this card (0 for the root). */
  step: number;
  laneId: string;
  /** Card the tree edge comes from (nearer the root); null for the root. */
  parentId: string | null;
  /** Set when this card is itself an entry point (a flow that runs into another flow). */
  entryKind?: EntryPointKind;
  /** The registration label of the root ('GET /api/users'). */
  entryLabel?: string;
  /** Root of an inline handler: "inline handler, lines a–b". */
  detail?: string;
  /** Alternatives of an ambiguous call, most relevant first. */
  candidates: FlowCandidate[];
}

/** How a hop is drawn. */
export type FlowEdgeKind = 'normal' | 'ambiguous' | 'unresolved' | 'cycle' | 'seen';

export interface FlowEdge {
  id: string;
  /** 1-based position in call order (the badge number and the step-through order). */
  step: number;
  /** Caller card and callee card (always caller → callee, also for `in`). */
  from: string;
  to: string;
  /** Hop type: call, create, use, throw, implement, override, extend. */
  type: string;
  ref: { file: string; line: number };
  /** `file:line` with the base name only, `×N` appended when the call site repeats. */
  label: string;
  count: number;
  kind: FlowEdgeKind;
  link: FlowLink;
  provenance: FlowProvenance;
  resolution: FlowResolution;
  confidence: number;
  /** Found by scanning source text or otherwise below 0.85: drawn dotted. */
  lowConfidence: boolean;
  /** The target sits in the same or an earlier column: drawn as a curved back-reference. */
  back: boolean;
  /** True when this hop first reached its target (the tree edge); the path highlight follows these. */
  tree: boolean;
  /** Explains the style in words (tooltip). */
  explain: string;
}

export interface FlowLaneModel {
  id: string;
  label: string;
  kind: FlowLaneKind;
  path: string;
  /** Zone colour slot (same palette as the Map's zones). */
  colorIndex: number;
  cardIds: string[];
}

export type FlowNoticeTone = 'info' | 'warn';

export interface FlowNotice {
  id: 'truncated' | 'empty' | 'text-derived' | 'unresolved' | 'ambiguous' | 'note';
  tone: FlowNoticeTone;
  text: string;
}

export interface FlowModel {
  direction: FlowDirection;
  rootId: string;
  cards: FlowCard[];
  edges: FlowEdge[];
  lanes: FlowLaneModel[];
  /** Number of columns (0-based max column + 1). */
  columns: number;
  notices: FlowNotice[];
  /** Plain-language caveats carried by the trace (`FlowTrace.notes`). */
  notes: string[];
  stats: { nodes: number; hops: number; unresolved: number; ambiguous: number; dropped: number; depthReached: number };
  /** Changes whenever anything that affects the picture changes (layout cache key). */
  key: string;
}

/** Emphasis states computed from the selection or the step-through. */
export type FlowCardState = 'normal' | 'path' | 'active' | 'dim';
export type FlowEdgeState = 'normal' | 'path' | 'active' | 'done' | 'dim';

/* ---------------- React Flow payloads ---------------- */

export interface FlowCardData extends Record<string, unknown> {
  card: FlowCard;
  /** Colour slot of the card's lane. */
  hue: number;
  state: FlowCardState;
  /** 0..100 quality score of the entity, when indexed. */
  quality?: number;
  candidatesOpen: boolean;
}

export interface FlowLaneData extends Record<string, unknown> {
  lane: FlowLaneModel;
  width: number;
  height: number;
}

export interface FlowEdgeData extends Record<string, unknown> {
  edge: FlowEdge;
  state: FlowEdgeState;
  /** Show the badge number (hidden on very dense traces until hover / step-through). */
  showStep: boolean;
  /** Draw the label at all (dense traces show labels only on the path, the step and hovered hops). */
  showLabel: boolean;
}
