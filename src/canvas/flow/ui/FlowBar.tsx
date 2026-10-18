/**
 * The Flow mode control strip: what is traced, how deep, which way, which relation types, how many nodes,
 * tests, step-through, copy / link / editor, and the way out. Every setting goes through the store; the
 * trace is requested again and the picture replaced when it arrives.
 */
import React, { useState } from 'react';
import type { FlowModel, FlowSpec } from '../../../contracts/canvas/index.js';
import { FLOW_MAX_DEPTH, FLOW_MAX_NODES_CHOICES } from '../../../contracts/canvas/index.js';
import { DEFAULT_FOLLOW, FLOW_FOLLOW_TYPES, FLOW_LIMITS, type FlowFollowType } from '../../../contracts/flow-constants.js';
import type { FlowTrace } from '../../../contracts/flow.js';
import { renderTraceText } from '../../../flow/render.js';
import { useCanvasStore } from '../../store/canvas-store';
import { copyText } from '../../components/explorer/clipboard';
import { useProjectContext } from '../../components/explorer/project-context';
import { EDITOR_LABELS, editorUrl } from '../../utils/editor-link';
import { COLORS, button } from '../../components/shared/ui';
import { FlowMeta } from './FlowMeta';
import { StepControls, type StepControlsProps } from './StepControls';

const FOLLOW_WORDS: Record<FlowFollowType, string> = { call: 'calls', create: 'creates', use: 'uses', throw: 'throws' };
const FOLLOW_HINTS: Record<FlowFollowType, string> = {
  call: 'Function and method calls', create: 'Constructors and child components (new X, <X />)', use: 'Functions and values referenced but not called', throw: 'Errors thrown',
};

export interface FlowBarProps {
  spec: FlowSpec;
  title: string;
  trace: FlowTrace | null;
  model: FlowModel | null;
  loading: boolean;
  steps: Omit<StepControlsProps, 'total'>;
  onChangeEntry: () => void;
  onExit: () => void;
}

function CopyButton({ label, text, testId, title }: { label: string; text: () => string; testId: string; title: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" data-testid={testId} title={title} style={button} onClick={() => void copyText(text()).then((ok) => { setDone(ok); setTimeout(() => setDone(false), 1600); })}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function FlowBar({ spec, title, trace, model, loading, steps, onChangeEntry, onExit }: FlowBarProps) {
  const setFlow = useCanvasStore((s) => s.setFlow);
  const scheme = useCanvasStore((s) => s.editorScheme);
  const { projectRoot } = useProjectContext();
  const follow = new Set<FlowFollowType>(spec.follow ?? DEFAULT_FOLLOW);
  const toggle = (t: FlowFollowType) => {
    const next = new Set(follow);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    if (next.size === 0) return;
    const list = FLOW_FOLLOW_TYPES.filter((x) => next.has(x));
    const isDefault = list.length === DEFAULT_FOLLOW.length && list.every((x) => DEFAULT_FOLLOW.includes(x));
    const { follow: _drop, ...rest } = spec;
    setFlow(isDefault ? rest : { ...rest, follow: list });
  };
  const href = trace ? editorUrl(scheme, projectRoot, trace.root.file, trace.root.line) : null;
  const maxNodes = spec.maxNodes ?? FLOW_LIMITS.maxNodes.default;

  return (
    <div className="fl-flow-bar" data-testid="flow-bar" role="group" aria-label="Flow mode">
      <strong className="fl-flow-title" data-testid="flow-title" title={title}>Flow: {title}</strong>
      <label title="How many calls deep to follow">
        Depth <b data-testid="flow-depth-value">{spec.depth}</b>
        <input type="range" data-testid="flow-depth" min={1} max={FLOW_MAX_DEPTH} step={1} value={spec.depth} onChange={(e) => setFlow({ ...spec, depth: Number(e.target.value) })} />
      </label>
      <span className="fl-flow-seg" role="group" aria-label="Direction">
        <button type="button" data-testid="flow-dir-out" aria-pressed={spec.direction === 'out'} title="What runs when this runs" onClick={() => setFlow({ ...spec, direction: 'out' })}>Calls out</button>
        <button type="button" data-testid="flow-dir-in" aria-pressed={spec.direction === 'in'} title="Who calls this, up to the entry points that start it" onClick={() => setFlow({ ...spec, direction: 'in' })}>Triggered by</button>
      </span>
      <span className="fl-flow-chips" role="group" aria-label="Follow">
        {FLOW_FOLLOW_TYPES.map((t) => (
          <button key={t} type="button" data-testid={`flow-follow-${t}`} aria-pressed={follow.has(t)} title={FOLLOW_HINTS[t]} onClick={() => toggle(t)}>{FOLLOW_WORDS[t]}</button>
        ))}
      </span>
      <label title="Most functions to draw; the nearest ones are kept">
        Max nodes
        <select data-testid="flow-max" value={maxNodes} onChange={(e) => setFlow({ ...spec, maxNodes: Number(e.target.value) })}>
          {FLOW_MAX_NODES_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label title="Also follow calls into test files">
        <input type="checkbox" data-testid="flow-tests" checked={!!spec.includeTests} onChange={(e) => setFlow({ ...spec, includeTests: e.target.checked })} />
        Include tests
      </label>
      <span style={{ flex: 1 }} />
      <StepControls {...steps} total={model?.edges.length ?? 0} />
      <button type="button" data-testid="flow-change" style={button} title="Pick another entry point" onClick={onChangeEntry}>Change…</button>
      <button type="button" data-testid="flow-exit" style={button} onClick={onExit} title="Leave Flow mode (Esc)">
        Exit flow <span style={{ color: COLORS.faint }}>Esc</span>
      </button>
      {model && (
        <FlowMeta model={model} loading={loading} depth={spec.depth}>
          <CopyButton testId="flow-copy-trace" label="Copy trace" title="Copy the trace as indented text (what the CLI and the assistant tools print)" text={() => (trace ? renderTraceText(trace) : '')} />
          <CopyButton testId="flow-copy-link" label="Copy link" title="Copy a link to this exact flow" text={() => window.location.href} />
          {href && <a data-testid="flow-editor" href={href} style={{ ...button, textDecoration: 'none' }} title={`Open the start in ${EDITOR_LABELS[scheme]}`}>Open in editor</a>}
        </FlowMeta>
      )}
    </div>
  );
}
