/**
 * A function / method / file card of the flow: kind glyph, name, `file:line`, quality dot, and the entry
 * tag on the root. Unresolved calls are dashed leaves ("?? fetch"); ambiguous ones carry a
 * "N candidates" chip that opens the alternatives.
 */
import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { FlowCardData } from '../../../contracts/canvas/index.js';
import { EntityIcon } from '../../components/shared/EntityIcon';
import { qualityColor } from '../../utils/color-scales';
import { ENTRY_KIND_TAGS, baseName, plural } from '../model/flow-labels';
import { useFlowUi } from './flow-context';

const hidden: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };
/** Every side can take a hop in either role (see `hopHandles`). */
const HANDLES: Array<[string, 'source' | 'target', Position]> = [
  ['in-l', 'target', Position.Left], ['out-r', 'source', Position.Right], ['in-r', 'target', Position.Right], ['out-l', 'source', Position.Left],
  ['in-t', 'target', Position.Top], ['out-b', 'source', Position.Bottom], ['in-b', 'target', Position.Bottom], ['out-t', 'source', Position.Top],
];

function Candidates({ data }: { data: FlowCardData }) {
  const ui = useFlowUi();
  const { card } = data;
  if (!data.candidatesOpen) return null;
  return (
    <div className="fl-flow-cands nodrag nopan" data-testid="flow-candidates" role="menu" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="fl-flow-cands-title">Any of these could run, depending on the object at runtime:</div>
      {card.candidates.map((c) => (
        <button key={c.id} type="button" role="menuitem" data-testid="flow-candidate" title={c.inTrace ? 'Select it in the picture' : 'Trace from it'} onClick={() => ui.pickCandidate(c)}>
          <span>{c.name}</span>
          <small>{c.where}{c.inTrace ? '' : ' (not expanded)'}</small>
        </button>
      ))}
    </div>
  );
}

export const FlowCardNode = React.memo(({ data }: NodeProps<Node<FlowCardData, 'flowCard'>>) => {
  const ui = useFlowUi();
  const { card } = data;
  const leaf = card.entityId === null;
  const n = card.candidates.length;
  const where = card.line > 0 ? `${baseName(card.file)}:${card.line}` : baseName(card.file);
  const tag = card.entryKind && (card.role === 'root' || card.role === 'trigger') ? ENTRY_KIND_TAGS[card.entryKind] : card.entryKind ? ENTRY_KIND_TAGS[card.entryKind] : '';
  const title = [
    card.entryLabel ?? card.name,
    leaf ? `Call written at ${card.file}:${card.line}. ${card.role === 'candidates' ? 'More than one function could run.' : 'The indexer could not tell which function this is.'}` : `${card.file}:${card.line}`,
    card.detail,
  ].filter(Boolean).join('\n');

  return (
    <div className="fl-flow-card" data-testid="flow-card" data-card-id={card.id} data-entity-id={card.entityId ?? ''} data-role={card.role} data-state={data.state}
      data-hue={data.hue} data-column={card.column} data-lane={card.laneId} data-step={card.step} title={title}>
      {HANDLES.map(([id, type, position]) => <Handle key={id} id={id} type={type} position={position} style={hidden} isConnectable={false} />)}
      <div className="fl-flow-head">
        {!leaf && <EntityIcon kind={card.kind} />}
        <span className="fl-flow-name">{card.role === 'root' && card.entryLabel ? card.entryLabel : card.name}</span>
        {tag && <span className={`fl-flow-tag${card.role === 'root' ? '' : ' is-soft'}`}>{tag}</span>}
        {n > 0 && (
          <button type="button" className="fl-flow-chip nodrag nopan" data-testid="flow-candidates-chip" aria-expanded={data.candidatesOpen}
            onClick={(e) => { e.stopPropagation(); ui.toggleCandidates(card.id); }} onDoubleClick={(e) => e.stopPropagation()}>
            {plural(n, 'candidate')}
          </button>
        )}
      </div>
      <div className="fl-flow-sub">
        {data.quality !== undefined && <span className="fl-flow-quality" title={`Quality ${Math.round(data.quality)} / 100`} style={{ background: qualityColor(data.quality) }} />}
        <span className="fl-flow-where">
          {[card.role === 'root' && card.kind !== 'file' ? card.name : '', where, card.role === 'root' ? card.detail : ''].filter(Boolean).join(' · ')}
        </span>
      </div>
      <Candidates data={data} />
    </div>
  );
});
FlowCardNode.displayName = 'FlowCardNode';
