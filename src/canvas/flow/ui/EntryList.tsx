/** The grouped, filtered list of entry points of the picker: HTTP routes, CLI commands, pages… with counts and confidence. */
import React, { useMemo } from 'react';
import type { EntryPoint } from '../../../contracts/flow.js';
import type { EntryPointKind } from '../../../contracts/flow-constants.js';
import { ENTRY_KIND_LABELS, ENTRY_KIND_ORDER, confidenceWord, percent } from '../model/flow-labels';

export interface EntryGroup {
  kind: EntryPointKind;
  label: string;
  /** Entries of this kind that match the filter. */
  entries: EntryPoint[];
  /** Entries of this kind in the whole project (the backend's count, before the filter and the page limit). */
  total: number;
}

/** Entries matching `filter` (label, file, evidence), grouped by kind in display order; empty groups are dropped. */
export function groupEntries(entries: EntryPoint[], counts: Record<string, number>, filter: string): EntryGroup[] {
  const q = filter.trim().toLowerCase();
  const match = (e: EntryPoint) => !q || `${e.label} ${e.file} ${e.qualified_name}`.toLowerCase().includes(q);
  return ENTRY_KIND_ORDER.flatMap((kind) => {
    const list = entries.filter((e) => e.kind === kind && match(e));
    return list.length === 0 ? [] : [{ kind, label: ENTRY_KIND_LABELS[kind], entries: list, total: counts[kind] ?? list.length }];
  });
}

function Entry({ entry, onPick }: { entry: EntryPoint; onPick: (e: EntryPoint) => void }) {
  const level = entry.confidence >= 0.85 ? 'sure' : entry.confidence >= 0.6 ? 'likely' : 'guess';
  return (
    <button type="button" className="fl-flow-entry" data-testid="flow-entry" data-label={entry.label} data-kind={entry.kind} title={entry.evidence} onClick={() => onPick(entry)}>
      <b>{entry.label}</b>
      <span className="fl-flow-conf" data-level={level} title={`Detected with ${percent(entry.confidence)} confidence: ${entry.evidence}`}>{confidenceWord(entry.confidence)} {percent(entry.confidence)}</span>
      <small>{entry.file}:{entry.line}{entry.span ? ' · inline handler' : ''}</small>
    </button>
  );
}

export function EntryList({ groups, onPick, filterActive }: { groups: EntryGroup[]; onPick: (e: EntryPoint) => void; filterActive: boolean }) {
  const open = useMemo(() => groups.length <= 3 || filterActive, [groups.length, filterActive]);
  return (
    <>
      {groups.map((g, i) => (
        <details key={g.kind} className="fl-flow-group" data-testid="flow-group" data-kind={g.kind} open={open || i < 2}>
          <summary>
            {g.label} <small data-testid="flow-group-count">{filterActive && g.entries.length !== g.total ? `${g.entries.length} of ${g.total}` : g.total}</small>
          </summary>
          {g.entries.map((e) => <Entry key={`${e.entity_id}:${e.label}:${e.line}`} entry={e} onPick={onPick} />)}
        </details>
      ))}
    </>
  );
}
