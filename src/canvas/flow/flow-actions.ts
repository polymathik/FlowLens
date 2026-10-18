/**
 * Entering, changing and leaving Flow mode from the UI (toolbar button, detail panel, context menu, the
 * `T` key, the entry-point picker, a double-click on a card). The pure part turns a map node into a target:
 * a function / method / class / file is traced; a folder, package or zone has no single start, so it opens
 * the entry-point picker limited to its path ("what can start in here?").
 */
import { useMemo } from 'react';
import type { Entity } from '../../contracts/entities.js';
import type { FlowSpan, FlowSpec } from '../../contracts/canvas/index.js';
import { FLOW_DEFAULT_DEPTH } from '../../contracts/canvas/index.js';
import type { FlowDirection } from '../../contracts/flow-constants.js';
import type { EntryPoint } from '../../contracts/flow.js';
import { PROJECT_NODE_ID, type Hierarchy } from '../../contracts/hierarchy.js';
import { resolveRef } from '../../analysis/hierarchy/index.js';
import { revealTarget } from '../utils/navigation';
import { useCanvasStore, useCanvasStoreApi } from '../store/canvas-store';

export type FlowTarget = { kind: 'trace'; id: string } | { kind: 'picker'; path: string };

/** For callers that only deal with files and folders (the zone menu). */
export const NO_ENTITIES: ReadonlyMap<string, Pick<Entity, 'kind'>> = new Map();

const TRACEABLE = new Set(['function', 'method', 'class', 'module']);

/** What "Trace from here" does for a map node, or null when it does nothing (a variable, a type, an unknown id). */
export function flowTargetOf(h: Hierarchy, entities: ReadonlyMap<string, Pick<Entity, 'kind'>>, nodeId: string | null | undefined): FlowTarget | null {
  if (!nodeId) return null;
  const n = h.nodes.get(nodeId);
  if (!n) return null;
  if (n.kind === 'file') return { kind: 'trace', id: n.path };
  if (n.kind === 'symbol') return TRACEABLE.has(entities.get(nodeId)?.kind ?? '') ? { kind: 'trace', id: nodeId } : null;
  if (nodeId === PROJECT_NODE_ID || n.kind === 'project') return { kind: 'picker', path: '' };
  if (n.kind === 'package' || n.kind === 'folder') return { kind: 'picker', path: n.path };
  return null;
}

const span = (e: EntryPoint): FlowSpan | undefined => (e.span ? { from: e.span.line_start, to: e.span.line_end } : undefined);

/** Spec of a picked entry point: its entity (+ inline-handler span) and its label, which is what the trace route resolves. */
export function specOfEntry(e: EntryPoint, current?: FlowSpec | null): FlowSpec {
  const s = span(e);
  return { ...carried(current), id: e.entity_id, direction: 'out', ...(s ? { span: s } : {}), label: e.label };
}

/** The settings (depth, follow, max nodes, tests) a new root inherits from the flow that is open. */
function carried(current?: FlowSpec | null): Pick<FlowSpec, 'depth' | 'direction' | 'follow' | 'maxNodes' | 'includeTests'> {
  return {
    depth: current?.depth ?? FLOW_DEFAULT_DEPTH,
    direction: current?.direction ?? 'out',
    ...(current?.follow ? { follow: current.follow } : {}),
    ...(current?.maxNodes !== undefined ? { maxNodes: current.maxNodes } : {}),
    ...(current?.includeTests ? { includeTests: true } : {}),
  };
}

export const specForTarget = (id: string, direction: FlowDirection, current?: FlowSpec | null, label?: string): FlowSpec => ({ ...carried(current), id, direction, ...(label ? { label } : {}) });

export interface FlowActions {
  active: boolean;
  /** Where the user came from when a card was opened in the structure map: the chip "Back to flow" returns there. */
  backLink: FlowSpec | null;
  clearBackLink: () => void;
  /** Trace `nodeId` (default: the selected node); a folder / package opens the picker for its path. False when nothing can start there. */
  enter: (nodeId?: string | null, direction?: FlowDirection) => boolean;
  canTrace: (nodeId?: string | null) => boolean;
  /** Trace an entry point chosen in the picker. */
  enterEntry: (entry: EntryPoint) => void;
  /** Trace an arbitrary entity id (a candidate, a search result); `label` is an entry label or name to send instead of the id. */
  enterId: (id: string, direction?: FlowDirection, label?: string) => void;
  /** Leave Flow mode, then open `nodeId` in the structure map; the flow stays one click (or Back) away. */
  openInMap: (nodeId: string) => void;
  openPicker: (path?: string) => void;
  closePicker: () => void;
  exit: () => void;
}

export function useFlowActions(hierarchy: Hierarchy, entities: ReadonlyMap<string, Pick<Entity, 'kind'>>): FlowActions {
  const store = useCanvasStoreApi();
  const active = useCanvasStore((s) => s.flow !== null);
  const backLink = useCanvasStore((s) => s.flowBack);
  return useMemo<FlowActions>(
    () => {
      const enterSpec = (id: string, direction: FlowDirection | undefined, label?: string) => {
        const s = store.getState();
        s.setFlowBack(null);
        s.setFlow(specForTarget(id, direction ?? s.flow?.direction ?? 'out', s.flow, label));
      };
      return {
        active, backLink, clearBackLink: () => store.getState().setFlowBack(null),
        enter: (nodeId, direction) => {
          const s = store.getState();
          const target = flowTargetOf(hierarchy, entities, nodeId ?? s.selectedNodeId);
          if (!target) return false;
          if (target.kind === 'picker') s.setFlowPicker({ ...(target.path ? { path: target.path } : {}) });
          else enterSpec(target.id, direction);
          return true;
        },
        canTrace: (nodeId) => !!flowTargetOf(hierarchy, entities, nodeId ?? store.getState().selectedNodeId),
        enterEntry: (entry) => {
          store.getState().setFlowBack(null);
          store.getState().setFlow(specOfEntry(entry, store.getState().flow));
        },
        enterId: (id, direction, label) => enterSpec(id, direction, label),
        openInMap: (nodeId) => {
          const s = store.getState();
          const back = s.flow;
          const node = hierarchy.nodes.has(nodeId) ? nodeId : resolveRef(hierarchy, nodeId);
          if (!node || node === PROJECT_NODE_ID) return;
          s.setFlowBack(back);
          s.navigateTo(revealTarget(hierarchy, node)); // also leaves Flow mode
        },
        openPicker: (path) => store.getState().setFlowPicker({ ...(path ? { path } : {}) }),
        closePicker: () => store.getState().setFlowPicker(null),
        exit: () => store.getState().setFlow(null),
      };
    },
    [store, hierarchy, entities, active, backLink],
  );
}
