/**
 * Flow mode: the overlay that replaces the Map's picture while a trace is open (the Map stays mounted
 * underneath, so closing the flow restores its camera). Pipeline:
 *
 *   FlowSpec (store) ─► useFlowTrace ─► FlowTrace ─► buildFlowModel ─► layoutFlow ─► buildFlowElements ─► FlowView
 *                                                       │                                 ▲
 *                                      selection / step ┴──────► emphasis ────────────────┘
 *
 * The previous picture stays on screen while a new trace loads. Clicking a card selects it in the detail
 * panel and lights the path from the root; double-clicking opens it in the structure map.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { Entity } from '../../../contracts/entities.js';
import type { FlowCardData, FlowSpec } from '../../../contracts/canvas/index.js';
import { useCanvasStore, useCanvasStoreApi } from '../../store/canvas-store';
import type { FlowActions } from '../flow-actions';
import { useFlowTrace } from '../hooks/useFlowTrace';
import { emphasisForSelection, emphasisForStep, stepCaption } from '../model/flow-emphasis';
import { displayName } from '../model/flow-labels';
import { buildFlowModel } from '../model/flow-model';
import { buildFlowElements } from '../model/flow-nodes';
import { layoutFlow } from '../model/flow-layout';
import { FlowBar } from './FlowBar';
import { FlowUiContext, type FlowUi } from './flow-context';
import { FlowError, FlowSkeleton } from './FlowStates';
import { FlowView } from './FlowView';
import { StepCaption } from './StepControls';
import { useReducedMotion } from './useReducedMotion';

const rootKey = (s: FlowSpec): string => `${s.id}#${s.span?.from ?? ''}`;

export function FlowMode({ actions, entityById }: { actions: FlowActions; entityById: Map<string, Entity> }) {
  const store = useCanvasStoreApi();
  const spec = useCanvasStore((s) => s.flow);
  const selectedStore = useCanvasStore((s) => s.selectedNodeId);
  if (!spec) return null;
  return <FlowModeBody spec={spec} actions={actions} entityById={entityById} selectedStore={selectedStore} store={store} />;
}

function FlowModeBody({ spec, actions, entityById, selectedStore, store }: { spec: FlowSpec; actions: FlowActions; entityById: Map<string, Entity>; selectedStore: string | null; store: ReturnType<typeof useCanvasStoreApi> }) {
  const reducedMotion = useReducedMotion();
  const load = useFlowTrace(spec);
  const { trace } = load;
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [leafSel, setLeafSel] = useState<string | null>(null);
  const [openCand, setOpenCand] = useState<string | null>(null);

  const model = useMemo(() => (trace ? buildFlowModel(trace, { entity: (id) => { const e = entityById.get(id); return e ? { name: e.name, file: e.file, line: e.location?.line_start ?? 0 } : undefined; } }) : null), [trace, entityById]);
  const layout = useMemo(() => (model ? layoutFlow(model) : null), [model]);
  const title = useMemo(() => {
    if (!trace || !model) return spec.resolved?.title ?? spec.label ?? spec.id;
    const root = model.cards.find((c) => c.id === model.rootId);
    return trace.root.kind !== 'unknown' ? trace.root.label : root ? (trace.root.span ? `${root.name} (inline handler)` : root.name) : displayName({ kind: 'function', name: trace.root.label, qualified_name: trace.root.qualified_name, file: trace.root.file });
  }, [trace, model, spec]);

  // The breadcrumb shows what the trace resolved to; the URL and the request do not depend on it.
  useEffect(() => {
    if (!trace) return;
    const cur = store.getState().flow;
    if (cur && rootKey(cur) === rootKey(spec) && (cur.resolved?.title !== title || cur.resolved.entityId !== trace.root.entity_id)) store.getState().setFlow({ ...cur, resolved: { title, entityId: trace.root.entity_id } });
  }, [trace, title, spec, store]);

  // A new picture starts clean: no step, no stale selection, no open candidate list.
  useEffect(() => {
    setStep(null);
    setPlaying(false);
    setLeafSel(null);
    setOpenCand(null);
  }, [model?.key]);

  const selected = leafSel ?? (model?.cards.some((c) => c.id === selectedStore) ? selectedStore : null);
  const emphasis = useMemo(() => (!model ? null : step !== null ? emphasisForStep(model, step) : emphasisForSelection(model, selected)), [model, step, selected]);
  const quality = useCallback((id: string) => entityById.get(id)?.metrics?.quality_score, [entityById]);
  const elements = useMemo(
    () => (model && layout ? buildFlowElements(model, layout, { emphasis, quality, openCandidates: openCand, forceSteps: step !== null }) : { nodes: [], edges: [] }),
    [model, layout, emphasis, quality, openCand, step],
  );
  const reveal = useMemo(() => {
    if (!model || step === null) return null;
    const e = model.edges.find((x) => x.step === step);
    return step === 0 || !e ? model.rootId : model.direction === 'out' ? e.to : e.from;
  }, [model, step]);

  const ui = useMemo<FlowUi>(() => ({
    toggleCandidates: (id) => setOpenCand((cur) => (cur === id ? null : id)),
    pickCandidate: (c) => {
      setOpenCand(null);
      if (c.inTrace) { setLeafSel(null); store.getState().selectNode(c.id); } else actions.enterId(c.id);
    },
  }), [store, actions]);

  const cardOf = (node: Node): FlowCardData['card'] | null => (node.type === 'flowCard' ? (node.data as FlowCardData).card : null);
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const card = cardOf(node);
    if (!card) return;
    setOpenCand(null);
    if (card.entityId) { setLeafSel(null); store.getState().selectNode(card.entityId); } else { setLeafSel(card.id); store.getState().selectNode(null); }
  }, [store]);
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const card = cardOf(node);
    if (card?.entityId) actions.openInMap(card.entityId);
  }, [actions]);
  const onPaneClick = useCallback(() => { setLeafSel(null); setOpenCand(null); store.getState().selectNode(null); }, [store]);

  const caption = model && step !== null ? stepCaption(model, step) : '';
  const busy = load.loading;

  return (
    <FlowUiContext.Provider value={ui}>
      <div className="fl-flow-root" data-testid="flow-view" data-root={spec.id} data-loading={busy ? '1' : '0'} data-direction={spec.direction}
        data-cards={model?.cards.length ?? 0} data-lanes={model?.lanes.length ?? 0} data-hops={model?.edges.length ?? 0} data-model-key={model?.key ?? ''}>
        <FlowBar spec={spec} title={title} trace={trace} model={model} loading={busy} onChangeEntry={() => actions.openPicker()} onExit={actions.exit}
          steps={{ step, playing, onStep: setStep, onPlaying: setPlaying }} />
        <div className={`fl-flow-stage${busy && trace ? ' is-loading' : ''}`} data-testid="flow-canvas">
          {model && <FlowView nodes={elements.nodes} edges={elements.edges} fitKey={model.key} reveal={reveal} reducedMotion={reducedMotion} onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onPaneClick={onPaneClick} />}
          <StepCaption step={step} caption={caption} />
          {busy && !trace && !load.error && <FlowSkeleton />}
          {load.error && <FlowError error={load.error} spec={spec} onRetry={load.reload} onPick={(id, label) => actions.enterId(id, undefined, label)} onPicker={() => actions.openPicker()} onSearch={() => store.getState().setSearchOpen(true)} onExit={actions.exit} />}
        </div>
      </div>
    </FlowUiContext.Provider>
  );
}
