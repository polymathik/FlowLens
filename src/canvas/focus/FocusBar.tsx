/**
 * The Focus mode control strip under the toolbar: what is focused, how far (depth 1-3), in which
 * direction, along which relation types, the exact count of what is drawn and what lies outside, the
 * cap notice, and the way out. Everything it changes goes through the store; the map recomputes.
 */
import React from 'react';
import type { FocusDirection, FocusInfo } from '../../contracts/canvas/index.js';
import { FOCUS_MAX_DEPTH } from '../../contracts/canvas/index.js';
import type { RelationType } from '../../contracts/relations.js';
import { useCanvasStore } from '../store/canvas-store';
import { RELATION_WORDS } from '../utils/relation-labels';
import { DEFAULT_VISIBLE_RELATION_TYPES } from '../utils/relation-defaults';
import { COLORS, button } from '../components/shared/ui';

const TYPES: RelationType[] = ['import', 'call', 'extend', 'implement', 'use', 'create', 'parameter', 'return'];
const DIRECTIONS: Array<{ value: FocusDirection; label: string; title: string }> = [
  { value: 'out', label: 'Uses', title: 'What the focus depends on (follows imports and calls outward)' },
  { value: 'in', label: 'Used by', title: 'What depends on the focus (its consumers)' },
  { value: 'both', label: 'Both', title: 'Dependencies and consumers' },
];

const kindWord = { file: 'file', symbol: 'symbol', container: 'group' } as const;

function Accounting({ info, cards }: { info: FocusInfo; cards: number }) {
  const { accounting: a } = info;
  return (
    <span data-testid="focus-accounting" style={{ color: COLORS.muted }}>
      {cards} card{cards === 1 ? '' : 's'}
      {info.folded > 0 && ` + ${info.folded} folded`} · {a.touching} relation{a.touching === 1 ? '' : 's'}
      {a.excludedByType > 0 && <span title="Relations of types that are switched off here; they touch the neighbourhood but are not drawn"> · +{a.excludedByType} other types</span>}
    </span>
  );
}

export function FocusBar({ info, cards, onExit }: { info?: FocusInfo; cards: number; onExit: () => void }) {
  const spec = useCanvasStore((s) => s.focus);
  const setFocus = useCanvasStore((s) => s.setFocus);
  if (!spec) return null;
  const types = new Set(info?.options.types ?? spec.types ?? DEFAULT_VISIBLE_RELATION_TYPES);
  const toggle = (t: RelationType) => {
    const next = new Set(types);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    if (next.size > 0) setFocus({ ...spec, types: TYPES.filter((x) => next.has(x)) });
  };
  return (
    <div className="fl-focus-bar" data-testid="focus-bar" role="group" aria-label="Focus mode">
      <strong data-testid="focus-title">Focus{info ? `: ${info.label}` : ''}</strong>
      {info && <span style={{ color: COLORS.faint }}>{kindWord[info.kind]}</span>}
      {!info && <span data-testid="focus-missing" style={{ color: COLORS.danger }}>This item is not in the index (any more).</span>}
      <label title="How many steps from the focus to follow">
        Depth <b data-testid="focus-depth-value">{spec.depth}</b>
        <input
          type="range"
          data-testid="focus-depth"
          min={1}
          max={FOCUS_MAX_DEPTH}
          step={1}
          value={spec.depth}
          onChange={(e) => setFocus({ ...spec, depth: Number(e.target.value) })}
        />
      </label>
      <span className="fl-focus-dir" role="group" aria-label="Direction">
        {DIRECTIONS.map((d) => (
          <button key={d.value} type="button" data-testid={`focus-dir-${d.value}`} aria-pressed={spec.direction === d.value} title={d.title} onClick={() => setFocus({ ...spec, direction: d.value })}>
            {d.label}
          </button>
        ))}
      </span>
      <span className="fl-focus-types" role="group" aria-label="Relation types">
        {TYPES.map((t) => (
          <button key={t} type="button" data-testid={`focus-type-${t}`} aria-pressed={types.has(t)} onClick={() => toggle(t)}>
            {RELATION_WORDS[t]}
          </button>
        ))}
      </span>
      <label title="Also draw links between neighbours that are not one step further from the focus">
        <input type="checkbox" data-testid="focus-lateral" checked={!!spec.lateral} onChange={(e) => setFocus({ ...spec, lateral: e.target.checked })} />
        Links between neighbours{info && !spec.lateral && info.accounting.lateral > 0 ? ` (${info.accounting.lateral} hidden)` : ''}
      </label>
      <span style={{ flex: 1 }} />
      <button type="button" data-testid="focus-exit" style={button} onClick={onExit} title="Leave Focus mode (Esc)">
        Exit focus <span style={{ color: COLORS.faint }}>Esc</span>
      </button>
      {info && (
        <div style={{ flexBasis: '100%', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Accounting info={info} cards={cards} />
          {info.notice && <span data-testid="focus-notice" style={{ color: COLORS.muted }}>{info.notice}</span>}
        </div>
      )}
    </div>
  );
}
