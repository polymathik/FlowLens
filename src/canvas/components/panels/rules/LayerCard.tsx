/**
 * One architecture layer: name, file patterns (chip list), and access rules
 * as toggle pills over the other layers' names — "may only use" (allow
 * list, optional) and "must not use" (deny list).
 */
import React from 'react';
import type { ArchitectureLayer } from '../../../../contracts/architecture.js';
import type { AccessRule } from '../../../utils/architecture-draft';
import { ChipInput } from './ChipInput';
import { COLORS, input, linkButton } from '../../shared/ui';

interface LayerCardProps {
  layer: ArchitectureLayer;
  otherNames: string[];
  violationCount: number;
  onRename: (name: string) => void;
  onPatterns: (patterns: string[]) => void;
  onToggle: (rule: AccessRule, target: string) => void;
  onRestrict: (restricted: boolean) => void;
  onDelete: () => void;
}

function Pills({ names, selected, onToggle, tone, testId }: { names: string[]; selected: string[]; onToggle: (n: string) => void; tone: string; testId: string }) {
  if (names.length === 0) return <div style={{ color: COLORS.faint, fontSize: 11 }}>Add another layer first.</div>;
  return (
    <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {names.map((n) => {
        const on = selected.includes(n);
        return (
          <button
            key={n}
            aria-pressed={on}
            onClick={() => onToggle(n)}
            style={{ padding: '1px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer', border: `1px solid ${on ? tone : COLORS.borderStrong}`, background: on ? `${tone}18` : '#fff', color: on ? tone : COLORS.muted }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

const label: React.CSSProperties = { fontSize: 11, color: COLORS.muted, margin: '8px 0 3px' };

export function LayerCard({ layer, otherNames, violationCount, onRename, onPatterns, onToggle, onRestrict, onDelete }: LayerCardProps) {
  const restricted = layer.may_only_access !== undefined;
  return (
    <div data-testid="layer-card" style={{ padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input aria-label="Layer name" value={layer.name} onChange={(e) => onRename(e.target.value)} style={{ ...input, fontWeight: 600 }} />
        {violationCount > 0 && (
          <span title="Rule breaks starting in this layer" style={{ color: COLORS.danger, fontSize: 11, whiteSpace: 'nowrap' }}>
            {violationCount} breaks
          </span>
        )}
        <button onClick={onDelete} style={{ ...linkButton, color: COLORS.danger }}>
          Delete
        </button>
      </div>
      <div style={label}>Files in this layer (glob patterns, press Enter to add)</div>
      <ChipInput testId="pattern-input" values={layer.include.patterns ?? []} onChange={onPatterns} placeholder="e.g. src/{api,routes}/**" />
      <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={restricted} onChange={(e) => onRestrict(e.target.checked)} />
        May only use these layers
      </label>
      {restricted && <Pills testId="may-only" names={otherNames} selected={layer.may_only_access ?? []} onToggle={(n) => onToggle('may_only_access', n)} tone={COLORS.ok} />}
      <div style={label}>Must not use</div>
      <Pills testId="must-not" names={otherNames} selected={layer.must_not_access ?? []} onToggle={(n) => onToggle('must_not_access', n)} tone={COLORS.danger} />
    </div>
  );
}
